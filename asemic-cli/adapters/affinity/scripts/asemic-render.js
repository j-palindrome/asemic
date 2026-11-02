'use strict';
// asemic-render — run by the affinity adapter through Affinity's MCP server (`mcp` SDK),
// never installed in the Scripts library. The adapter prepends
//   const ASEMIC = {doc, root, tag};   // doc = ops JSON, root = project folder,
//                                       // tag = "asemic <uuid>" (stable per row)
// and this draws doc.ops onto the current document (page units 0..1, y down -> pixels),
// inside one group named `tag`. Ops with `page` > 0 overflow: then every page gets its own
// artboard (`tag pN`, laid left -> right). Re-runs replace only groups named `tag` (+ drop surplus pages);
// all other layers stay. Only a document saved inside `root` is touched.

const { BlendMode } = require('affinity:common');
const { AddChildNodesCommandBuilder, DocumentCommand } = require('/commands.js');
const { Selection } = require('/selections.js');
const { SVG11 } = require('/colours.js');
const { Document } = require('/document.js');
const { FillDescriptor } = require('/fills.js');
const { CurveBuilder, PolyCurve, Rectangle } = require('/geometry.js');
const { LineStyleDescriptor } = require('/linestyle.js');
const { ShapeRectangle } = require('/shapes.js');
const { ContainerNodeDefinition, NodeChildType, PolyCurveNodeDefinition, ShapeNodeDefinition, ArtTextNodeDefinition } = require('/nodes.js');
const { StoryBuilder } = require('/storybuilder.js');
const { GlyphAtts, GlyphAttDoubleType } = require('/glyphatts.js');

const K = 0.5523; // cubic bezier quarter-circle handle

function ellipseCurve(cx, cy, rx, ry) {
    const b = CurveBuilder.create().beginXY(cx + rx, cy);
    b.addBezierXY(cx + rx, cy + ry * K, cx + rx * K, cy + ry, cx, cy + ry);
    b.addBezierXY(cx - rx * K, cy + ry, cx - rx, cy + ry * K, cx - rx, cy);
    b.addBezierXY(cx - rx, cy - ry * K, cx - rx * K, cy - ry, cx, cy - ry);
    b.addBezierXY(cx + rx * K, cy - ry, cx + rx, cy - ry * K, cx + rx, cy);
    return b.close().createCurve();
}

function polyCurve(pts, closed) {
    const b = CurveBuilder.create().beginXY(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) b.lineToXY(pts[i][0], pts[i][1]);
    if (closed) b.close();
    return b.createCurve();
}

function bezierCurve(pts) {
    const b = CurveBuilder.create().beginXY(pts[0][0], pts[0][1]);
    b.addBezierXY(pts[1][0], pts[1][1], pts[2][0], pts[2][1], pts[3][0], pts[3][1]);
    return b.createCurve();
}

function main() {
    const doc = Document.current;
    if (!doc) { console.log('asemic-render: open a document first'); return; }
    const path = String(doc.path || '');
    if (!path.startsWith(ASEMIC.root + '/')) {
        console.log(`asemic-render: skip — save the .af inside ${ASEMIC.root} (current: ${path || 'unsaved'})`);
        return;
    }
    const data = ASEMIC.doc;
    // Paused row: do nothing so the block freeze doesn't redraw over the last frame.
    if (data.paused) {
        console.log('asemic-render: paused');
        return;
    }
    const page = (op) => op.page || 0;
    const nPages = 1 + Math.max(0, ...data.ops.map(page));

    // Inspect available pages / spreads primarily on the document
    const spreads = [...doc.spreads];
    const userArtboards = [...doc.layers.all].filter((n) => n.isArtboardEnabled);
    const available_pages = (doc.pageCount && doc.pageCount > 0)
        ? doc.pageCount
        : (doc.spreadCount && doc.spreadCount > 0)
            ? doc.spreadCount
            : (userArtboards.length > 0 ? userArtboards.length : 1);

    // If a marker object is specified via ASEMIC.on, locate it in the document
    let markerNode = null;
    if (ASEMIC.on) {
        markerNode = [...doc.layers.all].find((n) => String(n.userDescription) === ASEMIC.on);
        if (!markerNode) {
            console.log(`asemic-render: error: marker object '${ASEMIC.on}' not found in document`);
            return;
        }
    }

    // Check page deficit
    const startPage = ASEMIC.page !== undefined && ASEMIC.page !== null ? Number(ASEMIC.page) : 0;
    if (startPage + nPages > available_pages && !markerNode) {
        const required = startPage + nPages;
        const missing = required - available_pages;
        console.log(`asemic-render: error: document has ${available_pages} page(s) but score requires ${required} pages; please add ${missing} page(s) to the document`);
        return;
    }

    // Existing groups for this row
    const groups = [];
    for (const n of doc.layers.all) {
        const d = String(n.userDescription);
        if (d === ASEMIC.tag || d.startsWith(`${ASEMIC.tag} `)) groups.push(n);
    }
    if (groups.length) doc.executeCommand(DocumentCommand.createDeleteSelection(Selection.create(doc, groups), true));

    // Base box: marker object if specified, else designated page's spread / artboard, else document
    const targetSpread = spreads[startPage] || doc.currentSpread;
    const spreadExtents = targetSpread?.getSpreadExtents ? targetSpread.getSpreadExtents({ includeSpread: true }) : null;
    const defaultBoard = userArtboards[startPage] || userArtboards[0];
    const box = markerNode
        ? markerNode.exactSpreadBaseBox
        : (spreadExtents
            ? spreadExtents
            : (defaultBoard ? defaultBoard.exactSpreadBaseBox : null));
    const W = box ? box.width : doc.widthPixels, H = box ? box.height : doc.heightPixels;
    const defaultOriginX = box ? box.x : 0;
    const defaultOriginY = box ? box.y : 0;
    const S = Math.min(W, H);

    // Determine target nodes for each page (spreads primarily, fallback to artboards)
    const targets = [];
    for (let i = 0; i < nPages; i++) {
        const idx = startPage + i;
        if (markerNode) {
            targets.push(markerNode);
        } else if (spreads.length > 0) {
            targets.push(spreads[idx] || spreads[spreads.length - 1]);
        } else if (userArtboards.length > 0) {
            targets.push(userArtboards[idx] || userArtboards[userArtboards.length - 1]);
        } else {
            targets.push(doc.currentSpread);
        }
    }

    const none = FillDescriptor.createNone();
    const black = FillDescriptor.createSolid(SVG11.black, BlendMode.Normal);
    let drawn = 0;
    targets.forEach((target, i) => {
        const ops = data.ops.filter((op) => page(op) === i);
        if (!ops.length) return;
        const targetBox = target?.exactSpreadBaseBox;
        const ox = markerNode ? defaultOriginX : (targetBox ? targetBox.x : defaultOriginX);
        const oy = markerNode ? defaultOriginY : (targetBox ? targetBox.y : defaultOriginY);
        const px = (p) => [ox + p[0] * W, oy + p[1] * H];
        // group creation + children = separate commands (SDK)
        let b = AddChildNodesCommandBuilder.create();
        b.addContainerNode(ContainerNodeDefinition.create(ASEMIC.tag));
        b.setInsertionTarget(target);
        const gcmd = b.createCommand(false, NodeChildType.Main);
        doc.executeCommand(gcmd);
        b = AddChildNodesCommandBuilder.create();
        b.setInsertionTarget(gcmd.newNodes[0]);
        // batch by stroke weight / fill so a whole page = a handful of nodes
        const strokes = new Map(), filled = PolyCurve.create(), textNodes = [];
        let nFilled = 0;
        const strokeGroup = (w) => {
            if (!strokes.has(w)) strokes.set(w, PolyCurve.create());
            return strokes.get(w);
        };
        for (const op of ops) {
            if (op.op === 'ellipse') {
                const [cx, cy] = px(op.c);
                const c = ellipseCurve(cx, cy, op.r[0] * S, op.r[1] * S);
                if (op.fill) { filled.addCurve(c); nFilled++; } else strokeGroup(op.w).addCurve(c);
            } else if (op.op === 'bezier' && op.pts.length === 4) {
                strokeGroup(op.w).addCurve(bezierCurve(op.pts.map(px)));
            } else if (op.pts && op.pts.length >= 2) {
                strokeGroup(op.w).addCurve(polyCurve(op.pts.map(px), op.op === 'poly' && op.closed));
            } else if (op.op === 'text' && op.text) {
                const [tx, ty] = px(op.c);
                const sb = StoryBuilder.create();
                const ga = GlyphAtts.create();
                ga.setDoubleValue(GlyphAttDoubleType.Height, op.size || 8.0);
                sb.setGlyphAtts(ga);
                sb.addText(String(op.text));
                const def = ArtTextNodeDefinition.createFromStoryBuilder({ x: tx, y: ty }, sb);
                def.userDescription = `${data.source} ${op.text}`;
                textNodes.push(def);
            }
        }
        for (const [w, pc] of strokes) {
            const def = PolyCurveNodeDefinition.create(pc, none, black, LineStyleDescriptor.createDefault(w), none);
            def.userDescription = `${data.source} w${w}`;
            b.addNode(def);
        }
        if (nFilled) {
            const def = PolyCurveNodeDefinition.create(filled, black, none, LineStyleDescriptor.createDefault(0), none);
            def.userDescription = `${data.source} heads`;
            b.addNode(def);
        }
        for (const tNode of textNodes) {
            b.addNode(tNode);
        }
        if (strokes.size || nFilled || textNodes.length) {  // empty AddChildNodes = INVALID_OP
            doc.executeCommand(b.createCommand(false, NodeChildType.Main));
            drawn++;
        }
    });
    if (!drawn) {
        console.log(`asemic-render: 0 ops from ${data.source} (mode drew nothing)`);
        return;
    }
    console.log(`asemic-render: ${data.ops.length} ops from ${data.source} frame ${data.frame}, ${nPages} page(s)`);
    console.log(`asemic-grab: ${doc.sessionUuid}`);
}

main();
