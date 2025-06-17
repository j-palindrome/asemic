import { max, range } from 'lodash';
import { Fn } from 'three/src/nodes/TSL.js';
import { atan, float, floor, If, instancedArray, instanceIndex, int, mix, mrt, output, screenSize, select, uniformArray, vec2, vec4 } from 'three/tsl';
import { Vector2, Vector4 } from 'three/webgpu';
import { bezierPosition, bezierRotation } from '../util/bezier';
export default class BrushBuilder {
    frame(elapsedTime) {
        if (elapsedTime >= this.nextTime) {
            const r = this.settings.renderInit;
            this.nextTime =
                typeof r === 'boolean'
                    ? r
                        ? elapsedTime + 1 / 60
                        : Infinity
                    : typeof r === 'number'
                        ? elapsedTime + r / 1000
                        : elapsedTime + r(this.nextTime * 1000) / 1000;
            // if (this.settings.renderClear) this.group.clear()
            // this.group.reInitialize(
            //   elapsedTime,
            //   this.renderer.getDrawingBufferSize(this.size)
            // )
            for (let i = 0; i < this.settings.maxCurves; i++) {
                this.info.controlPointCounts.array[i] = this.group[i].length;
            }
            const loadColorsArray = this.info.loadColors.array;
            const loadPositionsArray = this.info.loadPositions.array;
            for (let i = 0; i < this.settings.maxCurves; i++) {
                const curveIndex = i * this.settings.maxPoints;
                for (let j = 0; j < this.settings.maxPoints; j++) {
                    const point = this.group[i]?.at(j);
                    if (point) {
                        loadPositionsArray[curveIndex + j].set(point.x, point.y, 1, // strength
                        point.width);
                        loadColorsArray[curveIndex + j].set(
                        // point.color[0],
                        // point.color[1],
                        // point.color[2],
                        // point.alpha
                        1, 1, 1, 1);
                    }
                    else {
                        loadPositionsArray[curveIndex + j].set(0, 0, 0, 0);
                        loadColorsArray[curveIndex + j].set(0, 0, 0, 0);
                    }
                }
            }
            this.renderer.compute(this.loadControlPoints);
            this.onDraw();
        }
        this.renderer.compute(this.advanceControlPoints);
        this.onFrame();
    }
    dispose() {
        this.info.curvePositionArray.dispose();
        this.info.curveColorArray.dispose();
        // if (this.settings.onClick) {
        //   this.renderer.domElement.removeEventListener('click', this.onClick)
        // }
        // if (this.settings.onDrag) {
        //   this.renderer.domElement.removeEventListener('mouseover', this.onDrag)
        // }
        // if (this.settings.onOver) {
        //   this.renderer.domElement.removeEventListener('mouseover', this.onOver)
        // }
        this.onDispose();
    }
    getBezier(progress, position, extra) {
        const progressVar = progress.toVar();
        If(progressVar.equal(-1), () => {
            extra?.color?.assign(vec4(0, 0, 0, 0));
        }).Else(() => {
            progressVar.assign(floor(progress).add(this.settings.pointProgress(progress.fract(), {
                builder: this.group,
                progress
            })));
            extra?.progress?.assign(progressVar);
            const controlPointsCount = this.info.controlPointCounts.element(int(progressVar));
            const subdivisions = select(controlPointsCount.equal(2), 1, this.settings.adjustEnds === 'loop'
                ? controlPointsCount
                : controlPointsCount.sub(2)).toVar();
            //4 points: 4-2 = 2 0->1 1->2 (if it goes to the last value then it starts interpolating another curve)
            const t = vec2(progressVar.fract().mul(0.999).mul(subdivisions), floor(progressVar));
            const curveIndex = floor(progressVar).mul(this.settings.maxPoints);
            const pointIndex = progressVar.fract().mul(0.999).mul(subdivisions);
            const index = curveIndex.add(pointIndex).toVar();
            If(controlPointsCount.equal(2), () => {
                const p0 = this.info.curvePositionArray.element(index);
                const p1 = this.info.curvePositionArray.element(index.add(1));
                const progressPoint = mix(p0, p1, t.x);
                position.assign(progressPoint.xy);
                if (extra) {
                    const index = t.y.mul(this.settings.maxPoints).add(t.x);
                    // extra.color?.assign(this.info.curveColorArray.element(index))
                    extra.color?.assign(this.info.curveColorArray.element(0));
                    extra.width?.assign(progressPoint.w);
                    const rotationCalc = p1.xy.sub(p0.xy).toVar();
                    extra.rotation?.assign(atan(rotationCalc.y, rotationCalc.x));
                }
            }).Else(() => {
                const p0 = this.info.curvePositionArray.element(index).toVar();
                const p1 = this.info.curvePositionArray
                    .element(curveIndex.add(pointIndex.add(1).mod(controlPointsCount)))
                    .toVar();
                const p2 = this.info.curvePositionArray
                    .element(curveIndex.add(pointIndex.add(2).mod(controlPointsCount)))
                    .toVar();
                if (this.settings.adjustEnds === true) {
                    If(t.x.greaterThan(float(1)), () => {
                        p0.assign(mix(p0, p1, float(0.5)));
                    });
                    If(t.x.lessThan(float(controlPointsCount).sub(3)), () => {
                        p2.assign(mix(p1, p2, 0.5));
                    });
                }
                else {
                    p0.assign(mix(p0, p1, float(0.5)));
                    p2.assign(mix(p1, p2, 0.5));
                }
                const strength = p1.z;
                const pos = bezierPosition({
                    t: t.x.fract(),
                    p0: p0.xy,
                    p1: p1.xy,
                    p2: p2.xy,
                    strength
                });
                position.assign(pos);
                const c0 = this.info.curveColorArray.element(index);
                const c1 = this.info.curveColorArray.element(index.add(1));
                if (extra) {
                    extra.color?.assign(mix(c0, c1, t.x.fract()));
                    extra.width?.assign(bezierPosition({
                        t: t.x.fract(),
                        p0: vec2(0, p0.w),
                        p1: vec2(0.5, p1.w),
                        p2: vec2(1, p2.w),
                        strength
                    }).y);
                    extra.rotation?.assign(bezierRotation({
                        t: t.x.fract(),
                        p0: p0.xy,
                        p1: p1.xy,
                        p2: p2.xy,
                        strength
                    }));
                }
            });
        });
        position.assign(this.settings.pointPosition(position, { builder: this.group, progress }));
        if (extra) {
            extra.width?.assign(this.settings
                .pointThickness(extra.width, {
                progress: progressVar,
                builder: this.group
            })
                .div(screenSize.x));
            extra.rotation?.assign(this.settings.pointRotate(extra.rotation, {
                progress: extra.progress,
                builder: this.group
            }));
        }
    }
    screenToWorld(ev) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const x = (ev.clientX - rect.left) / rect.width;
        const y = (rect.height - (ev.clientY - rect.top)) / rect.width;
        return new Vector2(x, y);
    }
    getLength(group) { }
    constructor(settings, { renderer, group, scene }) {
        this.size = new Vector2();
        this.renderer = renderer;
        this.group = group;
        this.scene = scene;
        // this.group.reInitialize(0, this.renderer.getDrawingBufferSize(this.size))
        const defaultSettings = {
            maxLength: 0,
            maxCurves: 0,
            maxPoints: 0,
            align: 0.5,
            renderInit: false,
            renderClear: true,
            resample: true,
            renderStart: 0,
            squareAspect: false,
            spacing: 3,
            spacingType: 'pixel',
            adjustEnds: true,
            renderTargets: mrt({
                output
            }),
            pointProgress: input => input,
            pointPosition: input => input,
            pointColor: input => input,
            curvePosition: input => input,
            curveColor: input => input,
            pointRotate: input => input,
            pointThickness: input => input
        };
        this.settings = {
            ...defaultSettings,
            ...this.getDefaultBrushSettings(),
            ...settings
        };
        if (this.settings.maxPoints === 0) {
            this.settings.maxPoints = max(this.group.flatMap(x => x.length));
        }
        if (this.settings.maxLength === 0) {
            this.settings.maxLength = max(this.group.map(x => this.getLength(x)));
        }
        if (this.settings.maxCurves === 0) {
            this.settings.maxCurves = this.group.length;
        }
        const size = this.renderer.getDrawingBufferSize(new Vector2());
        this.info = {
            instancesPerCurve: Math.max(1, Math.floor(this.settings.spacingType === 'pixel'
                ? (this.settings.maxLength * size.width) / this.settings.spacing
                : this.settings.spacingType === 'width'
                    ? (this.settings.maxLength * size.width) /
                        (this.settings.spacing * size.width)
                    : this.settings.spacingType === 'count'
                        ? this.settings.spacing
                        : 0)),
            curvePositionArray: instancedArray(this.settings.maxPoints * this.settings.maxCurves, 'vec4'),
            curveColorArray: instancedArray(this.settings.maxPoints * this.settings.maxCurves, 'vec4'),
            loadPositions: uniformArray(range(this.settings.maxPoints * this.settings.maxCurves).map(x => new Vector4()), 'vec4'),
            loadColors: uniformArray(range(this.settings.maxPoints * this.settings.maxCurves).map(x => new Vector4()), 'vec4'),
            controlPointCounts: uniformArray(this.group.map(x => x.length), 'int')
        };
        this.advanceControlPoints = Fn(() => {
            const pointI = instanceIndex.mod(int(this.settings.maxPoints));
            const curveI = instanceIndex.div(this.settings.maxPoints);
            const info = {
                progress: curveI
                    .toFloat()
                    .add(pointI
                    .toFloat()
                    .div(this.info.controlPointCounts.element(curveI).sub(1))),
                builder: this.group
            };
            const index = curveI.mul(this.settings.maxPoints).add(pointI);
            const thisPosition = this.info.loadPositions.element(index);
            this.info.curvePositionArray.element(index).assign(this.settings.curvePosition(thisPosition, {
                ...info,
                lastFrame: this.info.curvePositionArray.element(index)
            }));
            const thisColor = this.info.loadColors.element(index);
            this.info.curveColorArray.element(index).assign(this.settings.curveColor(thisColor, {
                ...info,
                lastFrame: this.info.curveColorArray.element(index)
            }));
        })().compute(this.settings.maxPoints * this.settings.maxCurves);
        this.loadControlPoints = Fn(() => {
            this.info.curvePositionArray
                .element(instanceIndex)
                .assign(this.info.loadPositions.element(instanceIndex));
            this.info.curveColorArray
                .element(instanceIndex)
                .assign(this.info.loadColors.element(instanceIndex));
        })().compute(this.settings.maxCurves * this.settings.maxPoints);
        this.nextTime =
            (typeof this.settings.renderStart === 'function'
                ? this.settings.renderStart()
                : this.settings.renderStart) / 1000;
        this.onInit();
        this.frame(0);
        // if (this.settings.onClick) {
        //   this.renderer.domElement.addEventListener(
        //     'click',
        //     this.onClick.bind(this)
        //   )
        // }
        // if (this.settings.onDrag) {
        //   this.renderer.domElement.addEventListener(
        //     'mousemove',
        //     this.onDrag.bind(this)
        //   )
        // }
        // if (this.settings.onOver) {
        //   this.renderer.domElement.addEventListener(
        //     'mousemove',
        //     this.onOver.bind(this)
        //   )
        // }
        if (this.settings.maxPoints === 0) {
            this.settings.maxPoints = max(this.group.flatMap(x => x.length));
        }
        if (this.settings.maxLength === 0) {
            this.settings.maxLength = max(this.group.map(x => this.getLength(x)));
        }
        if (this.settings.maxCurves === 0) {
            this.settings.maxCurves = this.group.length;
        }
        this.info = {
            instancesPerCurve: Math.max(1, Math.floor(this.settings.spacingType === 'pixel'
                ? (this.settings.maxLength * size.width) / this.settings.spacing
                : this.settings.spacingType === 'width'
                    ? (this.settings.maxLength * size.width) /
                        (this.settings.spacing * size.width)
                    : this.settings.spacingType === 'count'
                        ? this.settings.spacing
                        : 0)),
            curvePositionArray: instancedArray(this.settings.maxPoints * this.settings.maxCurves, 'vec4'),
            curveColorArray: instancedArray(this.settings.maxPoints * this.settings.maxCurves, 'vec4'),
            loadPositions: uniformArray(range(this.settings.maxPoints * this.settings.maxCurves).map(x => new Vector4()), 'vec4'),
            loadColors: uniformArray(range(this.settings.maxPoints * this.settings.maxCurves).map(x => new Vector4()), 'vec4'),
            controlPointCounts: uniformArray(this.group.map(x => x.length), 'int')
        };
        this.advanceControlPoints = Fn(() => {
            const pointI = instanceIndex.modInt(this.settings.maxPoints);
            const curveI = instanceIndex.div(this.settings.maxPoints);
            const info = {
                progress: curveI
                    .toFloat()
                    .add(pointI
                    .toFloat()
                    .div(this.info.controlPointCounts.element(curveI).sub(1))),
                builder: this.group
            };
            const index = curveI.mul(this.settings.maxPoints).add(pointI);
            const thisPosition = this.info.loadPositions.element(index);
            this.info.curvePositionArray.element(index).assign(this.settings.curvePosition(thisPosition, {
                ...info,
                lastFrame: this.info.curvePositionArray.element(index)
            }));
            const thisColor = this.info.loadColors.element(index);
            this.info.curveColorArray.element(index).assign(this.settings.curveColor(thisColor, {
                ...info,
                lastFrame: this.info.curveColorArray.element(index)
            }));
        })().compute(this.settings.maxPoints * this.settings.maxCurves);
        this.loadControlPoints = Fn(() => {
            this.info.curvePositionArray
                .element(instanceIndex)
                .assign(this.info.loadPositions.element(instanceIndex));
            this.info.curveColorArray
                .element(instanceIndex)
                .assign(this.info.loadColors.element(instanceIndex));
        })().compute(this.settings.maxCurves * this.settings.maxPoints);
        this.nextTime =
            (typeof this.settings.renderStart === 'function'
                ? this.settings.renderStart()
                : this.settings.renderStart) / 1000;
        this.onInit();
        this.frame(0);
        // if (this.settings.onClick) {
        //   this.renderer.domElement.addEventListener(
        //     'click',
        //     this.onClick.bind(this)
        //   )
        // }
        // if (this.settings.onDrag) {
        //   this.renderer.domElement.addEventListener(
        //     'mousemove',
        //     this.onDrag.bind(this)
        //   )
        // }
        // if (this.settings.onOver) {
        //   this.renderer.domElement.addEventListener(
        //     'mousemove',
        //     this.onOver.bind(this)
        //   )
        // }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQnJ1c2hCdWlsZGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiQnJ1c2hCdWlsZGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sRUFBRSxHQUFHLEVBQUUsS0FBSyxFQUFFLE1BQU0sUUFBUSxDQUFBO0FBQ25DLE9BQU8sRUFBRSxFQUFFLEVBQUUsTUFBTSx3QkFBd0IsQ0FBQTtBQUMzQyxPQUFPLEVBQ0wsSUFBSSxFQUNKLEtBQUssRUFDTCxLQUFLLEVBQ0wsRUFBRSxFQUNGLGNBQWMsRUFDZCxhQUFhLEVBQ2IsR0FBRyxFQUNILEdBQUcsRUFDSCxHQUFHLEVBQ0gsTUFBTSxFQUNOLFVBQVUsRUFDVixNQUFNLEVBQ04sWUFBWSxFQUVaLElBQUksRUFDSixJQUFJLEVBQ0wsTUFBTSxXQUFXLENBQUE7QUFDbEIsT0FBTyxFQUdMLE9BQU8sRUFDUCxPQUFPLEVBRVIsTUFBTSxjQUFjLENBQUE7QUFDckIsT0FBTyxFQUFFLGNBQWMsRUFBRSxjQUFjLEVBQUUsTUFBTSxnQkFBZ0IsQ0FBQTtBQUcvRCxNQUFNLENBQUMsT0FBTyxPQUFnQixZQUFZO0lBcUJ4QyxLQUFLLENBQUMsV0FBbUI7UUFDdkIsSUFBSSxXQUFXLElBQUksSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ2pDLE1BQU0sQ0FBQyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFBO1lBQ2xDLElBQUksQ0FBQyxRQUFRO2dCQUNYLE9BQU8sQ0FBQyxLQUFLLFNBQVM7b0JBQ3BCLENBQUMsQ0FBQyxDQUFDO3dCQUNELENBQUMsQ0FBQyxXQUFXLEdBQUcsQ0FBQyxHQUFHLEVBQUU7d0JBQ3RCLENBQUMsQ0FBQyxRQUFRO29CQUNaLENBQUMsQ0FBQyxPQUFPLENBQUMsS0FBSyxRQUFRO3dCQUN2QixDQUFDLENBQUMsV0FBVyxHQUFHLENBQUMsR0FBRyxJQUFJO3dCQUN4QixDQUFDLENBQUMsV0FBVyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxH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SUFBSSxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQTtRQUN4RCxDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBRS9ELElBQUksQ0FBQyxRQUFRO1lBQ1gsQ0FBQyxPQUFPLElBQUksQ0FBQyxRQUFRLENBQUMsV0FBVyxLQUFLLFVBQVU7Z0JBQzlDLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLFdBQVcsRUFBRTtnQkFDN0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUFDLEdBQUcsSUFBSSxDQUFBO1FBRXZDLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQTtRQUNiLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFFYiwrQkFBK0I7UUFDL0IsK0NBQStDO1FBQy9DLGVBQWU7UUFDZiw4QkFBOEI7UUFDOUIsTUFBTTtRQUNOLElBQUk7UUFDSiw4QkFBOEI7UUFDOUIsK0NBQStDO1FBQy9DLG1CQUFtQjtRQUNuQiw2QkFBNkI7UUFDN0IsTUFBTTtRQUNOLElBQUk7UUFDSiw4QkFBOEI7UUFDOUIsK0NBQStDO1FBQy9DLG1CQUFtQjtRQUNuQiw2QkFBNkI7UUFDN0IsTUFBTTtRQUNOLElBQUk7SUFDTixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBtYXgsIHJhbmdlIH0gZnJvbSAnbG9kYXNoJ1xuaW1wb3J0IHsgRm4gfSBmcm9tICd0aHJlZS9zcmMvbm9kZXMvVFNMLmpzJ1xuaW1wb3J0IHtcbiAgYXRhbixcbiAgZmxvYXQsXG4gIGZsb29yLFxuICBJZixcbiAgaW5zdGFuY2VkQXJyYXksXG4gIGluc3RhbmNlSW5kZXgsXG4gIGludCxcbiAgbWl4LFxuICBtcnQsXG4gIG91dHB1dCxcbiAgc2NyZWVuU2l6ZSxcbiAgc2VsZWN0LFxuICB1bmlmb3JtQXJyYXksXG4gIHZhcnlpbmcsXG4gIHZlYzIsXG4gIHZlYzRcbn0gZnJvbSAndGhyZWUvdHNsJ1xuaW1wb3J0IHtcbiAgQ29tcHV0ZU5vZGUsXG4gIFNjZW5lLFxuICBWZWN0b3IyLFxuICBWZWN0b3I0LFxuICBXZWJHUFVSZW5kZXJlclxufSBmcm9tICd0aHJlZS93ZWJncHUnXG5pbXBvcnQgeyBiZXppZXJQb3NpdGlvbiwgYmV6aWVyUm90YXRpb24gfSBmcm9tICcuLi91dGlsL2JlemllcidcbmltcG9ydCB7IEFzZW1pY0dyb3VwIH0gZnJvbSAnc3JjL0FzZW1pY1B0J1xuXG5leHBvcnQgZGVmYXVsdCBhYnN0cmFjdCBjbGFzcyBCcnVzaEJ1aWxkZXI8VCBleHRlbmRzIEJydXNoVHlwZXM+IHtcbiAgcHJvdGVjdGVkIHNldHRpbmdzOiBQcm9jZXNzRGF0YTxUPiAmIEJydXNoRGF0YTxUPlxuICBwcm90ZWN0ZWQgaW5mbzoge1xuICAgIGNvbnRyb2xQb2ludENvdW50czogUmV0dXJuVHlwZTx0eXBlb2YgdW5pZm9ybUFycmF5PlxuICAgIGN1cnZlUG9zaXRpb25BcnJheTogUmV0dXJuVHlwZTx0eXBlb2YgaW5zdGFuY2VkQXJyYXk+XG4gICAgY3VydmVDb2xvckFycmF5OiBSZXR1cm5UeXBlPHR5cGVvZiBpbnN0YW5jZWRBcnJheT5cbiAgICBpbnN0YW5jZXNQZXJDdXJ2ZTogbnVtYmVyXG4gIH0gJiBSZWNvcmQ8c3RyaW5nLCBhbnk+XG4gIHByb3RlY3RlZCByZW5kZXJlcjogV2ViR1BVUmVuZGVyZXJcbiAgcHJvdGVjdGVkIHNjZW5lOiBTY2VuZVxuICBwcm90ZWN0ZWQgYWJzdHJhY3QgZ2V0RGVmYXVsdEJydXNoU2V0dGluZ3MoKTogQnJ1c2hEYXRhPFQ+XG4gIHByb3RlY3RlZCBhYnN0cmFjdCBvbkZyYW1lKClcbiAgcHJvdGVjdGVkIGFic3RyYWN0IG9uRHJhdygpXG4gIHByb3RlY3RlZCBhYnN0cmFjdCBvbkluaXQoKVxuICBwcm90ZWN0ZWQgYWJzdHJhY3Qgb25EaXNwb3NlKClcbiAgcHJvdGVjdGVkIGFkdmFuY2VDb250cm9sUG9pbnRzOiBDb21wdXRlTm9kZVxuICBwcm90ZWN0ZWQgbG9hZENvbnRyb2xQb2ludHM6IENvbXB1dGVOb2RlXG4gIHByb3RlY3RlZCBuZXh0VGltZTogbnVtYmVyXG4gIHByb3RlY3RlZCBzaXplID0gbmV3IFZlY3RvcjIoKVxuICBwcm90ZWN0ZWQgZ3JvdXA6IEFzZW1pY0dyb3VwW11cblxuICBmcmFtZShlbGFwc2VkVGltZTogbnVtYmVyKSB7XG4gICAgaWYgKGVsYXBzZWRUaW1lID49IHRoaXMubmV4dFRpbWUpIHtcbiAgICAgIGNvbnN0IHIgPSB0aGlzLnNldHRpbmdzLnJlbmRlckluaXRcbiAgICAgIHRoaXMubmV4dFRpbWUgPVxuICAgICAgICB0eXBlb2YgciA9PT0gJ2Jvb2xlYW4nXG4gICAgICAgICAgPyByXG4gICAgICAgICAgICA/IGVsYXBzZWRUaW1lICsgMSAvIDYwXG4gICAgICAgICAgICA6IEluZmluaXR5XG4gICAgICAgICAgOiB0eXBlb2YgciA9PT0gJ251bWJlcidcbiAgICAgICAgICA/IGVsYXBzZWRUaW1lICsgciAvIDEwMDBcbiAgICAgICAgICA6IGVsYXBzZWRUaW1lICsgcih0aGlzLm5leHRUaW1lICogMTAwMCkgLyAxMDAwXG4gICAgICAvLyBpZiAodGhpcy5zZXR0aW5ncy5yZW5kZXJDbGVhcikgdGhpcy5ncm91cC5jbGVhcigpXG4gICAgICAvLyB0aGlzLmdyb3VwLnJlSW5pdGlhbGl6ZShcbiAgICAgIC8vICAgZWxhcHNlZFRpbWUsXG4gICAgICAvLyAgIHRoaXMucmVuZGVyZXIuZ2V0RHJhd2luZ0J1ZmZlclNpemUodGhpcy5zaXplKVxuICAgICAgLy8gKVxuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLnNldHRpbmdzLm1heEN1cnZlczsgaSsrKSB7XG4gICAgICAgIHRoaXMuaW5mby5jb250cm9sUG9pbnRDb3VudHMuYXJyYXlbaV0gPSB0aGlzLmdyb3VwW2ldLmxlbmd0aFxuICAgICAgfVxuICAgICAgY29uc3QgbG9hZENvbG9yc0FycmF5ID0gdGhpcy5pbmZvLmxvYWRDb2xvcnMuYXJyYXkgYXMgVmVjdG9yNFtdXG4gICAgICBjb25zdCBsb2FkUG9zaXRpb25zQXJyYXkgPSB0aGlzLmluZm8ubG9hZFBvc2l0aW9ucy5hcnJheSBhcyBWZWN0b3I0W11cbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5zZXR0aW5ncy5tYXhDdXJ2ZXM7IGkrKykge1xuICAgICAgICBjb25zdCBjdXJ2ZUluZGV4ID0gaSAqIHRoaXMuc2V0dGluZ3MubWF4UG9pbnRzXG4gICAgICAgIGZvciAobGV0IGogPSAwOyBqIDwgdGhpcy5zZXR0aW5ncy5tYXhQb2ludHM7IGorKykge1xuICAgICAgICAgIGNvbnN0IHBvaW50ID0gdGhpcy5ncm91cFtpXT8uYXQoailcbiAgICAgICAgICBpZiAocG9pbnQpIHtcbiAgICAgICAgICAgIGxvYWRQb3NpdGlvbnNBcnJheVtjdXJ2ZUluZGV4ICsgal0uc2V0KFxuICAgICAgICAgICAgICBwb2ludC54LFxuICAgICAgICAgICAgICBwb2ludC55LFxuICAgICAgICAgICAgICAxLCAvLyBzdHJlbmd0aFxuICAgICAgICAgICAgICBwb2ludC53aWR0aFxuICAgICAgICAgICAgKVxuICAgICAgICAgICAgbG9hZENvbG9yc0FycmF5W2N1cnZlSW5kZXggKyBqXS5zZXQoXG4gICAgICAgICAgICAgIC8vIHBvaW50LmNvbG9yWzBdLFxuICAgICAgICAgICAgICAvLyBwb2ludC5jb2xvclsxXSxcbiAgICAgICAgICAgICAgLy8gcG9pbnQuY29sb3JbMl0sXG4gICAgICAgICAgICAgIC8vIHBvaW50LmFscGhhXG4gICAgICAgICAgICAgIDEsXG4gICAgICAgICAgICAgIDEsXG4gICAgICAgICAgICAgIDEsXG4gICAgICAgICAgICAgIDFcbiAgICAgICAgICAgIClcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbG9hZFBvc2l0aW9uc0FycmF5W2N1cnZlSW5kZXggKyBqXS5zZXQoMCwgMCwgMCwgMClcbiAgICAgICAgICAgIGxvYWRDb2xvcnNBcnJheVtjdXJ2ZUluZGV4ICsgal0uc2V0KDAsIDAsIDAsIDApXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICB0aGlzLnJlbmRlcmVyLmNvbXB1dGUodGhpcy5sb2FkQ29udHJvbFBvaW50cylcbiAgICAgIHRoaXMub25EcmF3KClcbiAgICB9XG4gICAgdGhpcy5yZW5kZXJlci5jb21wdXRlKHRoaXMuYWR2YW5jZUNvbnRyb2xQb2ludHMpXG4gICAgdGhpcy5vbkZyYW1lKClcbiAgfVxuXG4gIGRpc3Bvc2UoKSB7XG4gICAgdGhpcy5pbmZvLmN1cnZlUG9zaXRpb25BcnJheS5kaXNwb3NlKClcbiAgICB0aGlzLmluZm8uY3VydmVDb2xvckFycmF5LmRpc3Bvc2UoKVxuICAgIC8vIGlmICh0aGlzLnNldHRpbmdzLm9uQ2xpY2spIHtcbiAgICAvLyAgIHRoaXMucmVuZGVyZXIuZG9tRWxlbWVudC5yZW1vdmVFdmVudExpc3RlbmVyKCdjbGljaycsIHRoaXMub25DbGljaylcbiAgICAvLyB9XG4gICAgLy8gaWYgKHRoaXMuc2V0dGluZ3Mub25EcmFnKSB7XG4gICAgLy8gICB0aGlzLnJlbmRlcmVyLmRvbUVsZW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcignbW91c2VvdmVyJywgdGhpcy5vbkRyYWcpXG4gICAgLy8gfVxuICAgIC8vIGlmICh0aGlzLnNldHRpbmdzLm9uT3Zlcikge1xuICAgIC8vICAgdGhpcy5yZW5kZXJlci5kb21FbGVtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21vdXNlb3ZlcicsIHRoaXMub25PdmVyKVxuICAgIC8vIH1cbiAgICB0aGlzLm9uRGlzcG9zZSgpXG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0QmV6aWVyKFxuICAgIHByb2dyZXNzOiBSZXR1cm5UeXBlPHR5cGVvZiBmbG9hdD4sXG4gICAgcG9zaXRpb246IFJldHVyblR5cGU8dHlwZW9mIHZlYzI+LFxuICAgIGV4dHJhPzoge1xuICAgICAgcm90YXRpb24/OiBSZXR1cm5UeXBlPHR5cGVvZiBmbG9hdD5cbiAgICAgIHdpZHRoPzogUmV0dXJuVHlwZTx0eXBlb2YgZmxvYXQ+XG4gICAgICBjb2xvcj86XG4gICAgICAgIHwgUmV0dXJuVHlwZTx0eXBlb2YgdmFyeWluZz5cbiAgICAgICAgfCBSZXR1cm5UeXBlPFJldHVyblR5cGU8dHlwZW9mIGZsb2F0PlsndG9WYXInXT5cbiAgICAgIHByb2dyZXNzPzogUmV0dXJuVHlwZTx0eXBlb2YgdmFyeWluZz5cbiAgICB9XG4gICkge1xuICAgIGNvbnN0IHByb2dyZXNzVmFyID0gcHJvZ3Jlc3MudG9WYXIoKVxuICAgIElmKHByb2dyZXNzVmFyLmVxdWFsKC0xKSwgKCkgPT4ge1xuICAgICAgZXh0cmE/LmNvbG9yPy5hc3NpZ24odmVjNCgwLCAwLCAwLCAwKSlcbiAgICB9KS5FbHNlKCgpID0+IHtcbiAgICAgIHByb2dyZXNzVmFyLmFzc2lnbihcbiAgICAgICAgZmxvb3IocHJvZ3Jlc3MpLmFkZChcbiAgICAgICAgICB0aGlzLnNldHRpbmdzLnBvaW50UHJvZ3Jlc3MocHJvZ3Jlc3MuZnJhY3QoKSwge1xuICAgICAgICAgICAgYnVpbGRlcjogdGhpcy5ncm91cCxcbiAgICAgICAgICAgIHByb2dyZXNzXG4gICAgICAgICAgfSlcbiAgICAgICAgKVxuICAgICAgKVxuICAgICAgZXh0cmE/LnByb2dyZXNzPy5hc3NpZ24ocHJvZ3Jlc3NWYXIpXG4gICAgICBjb25zdCBjb250cm9sUG9pbnRzQ291bnQgPSB0aGlzLmluZm8uY29udHJvbFBvaW50Q291bnRzLmVsZW1lbnQoXG4gICAgICAgIGludChwcm9ncmVzc1ZhcilcbiAgICAgIClcbiAgICAgIGNvbnN0IHN1YmRpdmlzaW9ucyA9IHNlbGVjdChcbiAgICAgICAgY29udHJvbFBvaW50c0NvdW50LmVxdWFsKDIpLFxuICAgICAgICAxLFxuICAgICAgICB0aGlzLnNldHRpbmdzLmFkanVzdEVuZHMgPT09ICdsb29wJ1xuICAgICAgICAgID8gY29udHJvbFBvaW50c0NvdW50XG4gICAgICAgICAgOiBjb250cm9sUG9pbnRzQ291bnQuc3ViKDIpXG4gICAgICApLnRvVmFyKClcblxuICAgICAgLy80IHBvaW50czogNC0yID0gMiAwLT4xIDEtPjIgKGlmIGl0IGdvZXMgdG8gdGhlIGxhc3QgdmFsdWUgdGhlbiBpdCBzdGFydHMgaW50ZXJwb2xhdGluZyBhbm90aGVyIGN1cnZlKVxuICAgICAgY29uc3QgdCA9IHZlYzIoXG4gICAgICAgIHByb2dyZXNzVmFyLmZyYWN0KCkubXVsKDAuOTk5KS5tdWwoc3ViZGl2aXNpb25zKSxcbiAgICAgICAgZmxvb3IocHJvZ3Jlc3NWYXIpXG4gICAgICApXG4gICAgICBjb25zdCBjdXJ2ZUluZGV4ID0gZmxvb3IocHJvZ3Jlc3NWYXIpLm11bCh0aGlzLnNldHRpbmdzLm1heFBvaW50cylcbiAgICAgIGNvbnN0IHBvaW50SW5kZXggPSBwcm9ncmVzc1Zhci5mcmFjdCgpLm11bCgwLjk5OSkubXVsKHN1YmRpdmlzaW9ucylcbiAgICAgIGNvbnN0IGluZGV4ID0gY3VydmVJbmRleC5hZGQocG9pbnRJbmRleCkudG9WYXIoKVxuXG4gICAgICBJZihjb250cm9sUG9pbnRzQ291bnQuZXF1YWwoMiksICgpID0+IHtcbiAgICAgICAgY29uc3QgcDAgPSB0aGlzLmluZm8uY3VydmVQb3NpdGlvbkFycmF5LmVsZW1lbnQoaW5kZXgpXG4gICAgICAgIGNvbnN0IHAxID0gdGhpcy5pbmZvLmN1cnZlUG9zaXRpb25BcnJheS5lbGVtZW50KGluZGV4LmFkZCgxKSlcbiAgICAgICAgY29uc3QgcHJvZ3Jlc3NQb2ludCA9IG1peChwMCwgcDEsIHQueClcblxuICAgICAgICBwb3NpdGlvbi5hc3NpZ24ocHJvZ3Jlc3NQb2ludC54eSlcbiAgICAgICAgaWYgKGV4dHJhKSB7XG4gICAgICAgICAgY29uc3QgaW5kZXggPSB0LnkubXVsKHRoaXMuc2V0dGluZ3MubWF4UG9pbnRzKS5hZGQodC54KVxuICAgICAgICAgIC8vIGV4dHJhLmNvbG9yPy5hc3NpZ24odGhpcy5pbmZvLmN1cnZlQ29sb3JBcnJheS5lbGVtZW50KGluZGV4KSlcbiAgICAgICAgICBleHRyYS5jb2xvcj8uYXNzaWduKHRoaXMuaW5mby5jdXJ2ZUNvbG9yQXJyYXkuZWxlbWVudCgwKSlcbiAgICAgICAgICBleHRyYS53aWR0aD8uYXNzaWduKHByb2dyZXNzUG9pbnQudylcbiAgICAgICAgICBjb25zdCByb3RhdGlvbkNhbGMgPSBwMS54eS5zdWIocDAueHkpLnRvVmFyKClcbiAgICAgICAgICBleHRyYS5yb3RhdGlvbj8uYXNzaWduKGF0YW4ocm90YXRpb25DYWxjLnksIHJvdGF0aW9uQ2FsYy54KSlcbiAgICAgICAgfVxuICAgICAgfSkuRWxzZSgoKSA9PiB7XG4gICAgICAgIGNvbnN0IHAwID0gdGhpcy5pbmZvLmN1cnZlUG9zaXRpb25BcnJheS5lbGVtZW50KGluZGV4KS50b1ZhcigpXG4gICAgICAgIGNvbnN0IHAxID0gdGhpcy5pbmZvLmN1cnZlUG9zaXRpb25BcnJheVxuICAgICAgICAgIC5lbGVtZW50KGN1cnZlSW5kZXguYWRkKHBvaW50SW5kZXguYWRkKDEpLm1vZChjb250cm9sUG9pbnRzQ291bnQpKSlcbiAgICAgICAgICAudG9WYXIoKVxuICAgICAgICBjb25zdCBwMiA9IHRoaXMuaW5mby5jdXJ2ZVBvc2l0aW9uQXJyYXlcbiAgICAgICAgICAuZWxlbWVudChjdXJ2ZUluZGV4LmFkZChwb2ludEluZGV4LmFkZCgyKS5tb2QoY29udHJvbFBvaW50c0NvdW50KSkpXG4gICAgICAgICAgLnRvVmFyKClcblxuICAgICAgICBpZiAodGhpcy5zZXR0aW5ncy5hZGp1c3RFbmRzID09PSB0cnVlKSB7XG4gICAgICAgICAgSWYodC54LmdyZWF0ZXJUaGFuKGZsb2F0KDEpKSwgKCkgPT4ge1xuICAgICAgICAgICAgcDAuYXNzaWduKG1peChwMCwgcDEsIGZsb2F0KDAuNSkpKVxuICAgICAgICAgIH0pXG4gICAgICAgICAgSWYodC54Lmxlc3NUaGFuKGZsb2F0KGNvbnRyb2xQb2ludHNDb3VudCkuc3ViKDMpKSwgKCkgPT4ge1xuICAgICAgICAgICAgcDIuYXNzaWduKG1peChwMSwgcDIsIDAuNSkpXG4gICAgICAgICAgfSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBwMC5hc3NpZ24obWl4KHAwLCBwMSwgZmxvYXQoMC41KSkpXG4gICAgICAgICAgcDIuYXNzaWduKG1peChwMSwgcDIsIDAuNSkpXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzdHJlbmd0aCA9IHAxLnpcbiAgICAgICAgY29uc3QgcG9zID0gYmV6aWVyUG9zaXRpb24oe1xuICAgICAgICAgIHQ6IHQueC5mcmFjdCgpLFxuICAgICAgICAgIHAwOiBwMC54eSxcbiAgICAgICAgICBwMTogcDEueHksXG4gICAgICAgICAgcDI6IHAyLnh5LFxuICAgICAgICAgIHN0cmVuZ3RoXG4gICAgICAgIH0pXG5cbiAgICAgICAgcG9zaXRpb24uYXNzaWduKHBvcylcbiAgICAgICAgY29uc3QgYzAgPSB0aGlzLmluZm8uY3VydmVDb2xvckFycmF5LmVsZW1lbnQoaW5kZXgpXG4gICAgICAgIGNvbnN0IGMxID0gdGhpcy5pbmZvLmN1cnZlQ29sb3JBcnJheS5lbGVtZW50KGluZGV4LmFkZCgxKSlcbiAgICAgICAgaWYgKGV4dHJhKSB7XG4gICAgICAgICAgZXh0cmEuY29sb3I/LmFzc2lnbihtaXgoYzAsIGMxLCB0LnguZnJhY3QoKSkpXG4gICAgICAgICAgZXh0cmEud2lkdGg/LmFzc2lnbihcbiAgICAgICAgICAgIGJlemllclBvc2l0aW9uKHtcbiAgICAgICAgICAgICAgdDogdC54LmZyYWN0KCksXG4gICAgICAgICAgICAgIHAwOiB2ZWMyKDAsIHAwLncpLFxuICAgICAgICAgICAgICBwMTogdmVjMigwLjUsIHAxLncpLFxuICAgICAgICAgICAgICBwMjogdmVjMigxLCBwMi53KSxcbiAgICAgICAgICAgICAgc3RyZW5ndGhcbiAgICAgICAgICAgIH0pLnlcbiAgICAgICAgICApXG4gICAgICAgICAgZXh0cmEucm90YXRpb24/LmFzc2lnbihcbiAgICAgICAgICAgIGJlemllclJvdGF0aW9uKHtcbiAgICAgICAgICAgICAgdDogdC54LmZyYWN0KCksXG4gICAgICAgICAgICAgIHAwOiBwMC54eSxcbiAgICAgICAgICAgICAgcDE6IHAxLnh5LFxuICAgICAgICAgICAgICBwMjogcDIueHksXG4gICAgICAgICAgICAgIHN0cmVuZ3RoXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIClcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9KVxuICAgIHBvc2l0aW9uLmFzc2lnbihcbiAgICAgIHRoaXMuc2V0dGluZ3MucG9pbnRQb3NpdGlvbihwb3NpdGlvbiwgeyBidWlsZGVyOiB0aGlzLmdyb3VwLCBwcm9ncmVzcyB9KVxuICAgIClcbiAgICBpZiAoZXh0cmEpIHtcbiAgICAgIGV4dHJhLndpZHRoPy5hc3NpZ24oXG4gICAgICAgIHRoaXMuc2V0dGluZ3NcbiAgICAgICAgICAucG9pbnRUaGlja25lc3MoZXh0cmEud2lkdGgsIHtcbiAgICAgICAgICAgIHByb2dyZXNzOiBwcm9ncmVzc1ZhcixcbiAgICAgICAgICAgIGJ1aWxkZXI6IHRoaXMuZ3JvdXBcbiAgICAgICAgICB9KVxuICAgICAgICAgIC5kaXYoc2NyZWVuU2l6ZS54KVxuICAgICAgKVxuICAgICAgZXh0cmEucm90YXRpb24/LmFzc2lnbihcbiAgICAgICAgdGhpcy5zZXR0aW5ncy5wb2ludFJvdGF0ZShleHRyYS5yb3RhdGlvbiEsIHtcbiAgICAgICAgICBwcm9ncmVzczogZXh0cmEucHJvZ3Jlc3MhLFxuICAgICAgICAgIGJ1aWxkZXI6IHRoaXMuZ3JvdXBcbiAgICAgICAgfSlcbiAgICAgIClcbiAgICB9XG4gIH1cblxuICBzY3JlZW5Ub1dvcmxkKGV2OiBNb3VzZUV2ZW50KSB7XG4gICAgY29uc3QgcmVjdCA9IHRoaXMucmVuZGVyZXIuZG9tRWxlbWVudC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKVxuICAgIGNvbnN0IHggPSAoZXYuY2xpZW50WCAtIHJlY3QubGVmdCkgLyByZWN0LndpZHRoXG4gICAgY29uc3QgeSA9IChyZWN0LmhlaWdodCAtIChldi5jbGllbnRZIC0gcmVjdC50b3ApKSAvIHJlY3Qud2lkdGhcbiAgICByZXR1cm4gbmV3IFZlY3RvcjIoeCwgeSlcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRMZW5ndGgoZ3JvdXA6IEFzZW1pY0dyb3VwKSB7fVxuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHNldHRpbmdzOiBQYXJ0aWFsPFByb2Nlc3NEYXRhPFQ+PiAmIFBhcnRpYWw8QnJ1c2hEYXRhPFQ+PixcbiAgICB7XG4gICAgICByZW5kZXJlcixcbiAgICAgIGdyb3VwLFxuICAgICAgc2NlbmVcbiAgICB9OiB7IHJlbmRlcmVyOiBXZWJHUFVSZW5kZXJlcjsgZ3JvdXA6IEFzZW1pY0dyb3VwW107IHNjZW5lOiBTY2VuZSB9XG4gICkge1xuICAgIHRoaXMucmVuZGVyZXIgPSByZW5kZXJlclxuICAgIHRoaXMuZ3JvdXAgPSBncm91cFxuICAgIHRoaXMuc2NlbmUgPSBzY2VuZVxuXG4gICAgLy8gdGhpcy5ncm91cC5yZUluaXRpYWxpemUoMCwgdGhpcy5yZW5kZXJlci5nZXREcmF3aW5nQnVmZmVyU2l6ZSh0aGlzLnNpemUpKVxuXG4gICAgY29uc3QgZGVmYXVsdFNldHRpbmdzOiBQcm9jZXNzRGF0YTxUPiA9IHtcbiAgICAgIG1heExlbmd0aDogMCxcbiAgICAgIG1heEN1cnZlczogMCxcbiAgICAgIG1heFBvaW50czogMCxcbiAgICAgIGFsaWduOiAwLjUsXG4gICAgICByZW5kZXJJbml0OiBmYWxzZSxcbiAgICAgIHJlbmRlckNsZWFyOiB0cnVlLFxuICAgICAgcmVzYW1wbGU6IHRydWUsXG4gICAgICByZW5kZXJTdGFydDogMCxcbiAgICAgIHNxdWFyZUFzcGVjdDogZmFsc2UsXG4gICAgICBzcGFjaW5nOiAzLFxuICAgICAgc3BhY2luZ1R5cGU6ICdwaXhlbCcsXG4gICAgICBhZGp1c3RFbmRzOiB0cnVlLFxuICAgICAgcmVuZGVyVGFyZ2V0czogbXJ0KHtcbiAgICAgICAgb3V0cHV0XG4gICAgICB9KSxcbiAgICAgIHBvaW50UHJvZ3Jlc3M6IGlucHV0ID0+IGlucHV0LFxuICAgICAgcG9pbnRQb3NpdGlvbjogaW5wdXQgPT4gaW5wdXQsXG4gICAgICBwb2ludENvbG9yOiBpbnB1dCA9PiBpbnB1dCxcbiAgICAgIGN1cnZlUG9zaXRpb246IGlucHV0ID0+IGlucHV0LFxuICAgICAgY3VydmVDb2xvcjogaW5wdXQgPT4gaW5wdXQsXG4gICAgICBwb2ludFJvdGF0ZTogaW5wdXQgPT4gaW5wdXQsXG4gICAgICBwb2ludFRoaWNrbmVzczogaW5wdXQgPT4gaW5wdXRcbiAgICB9XG5cbiAgICB0aGlzLnNldHRpbmdzID0ge1xuICAgICAgLi4uZGVmYXVsdFNldHRpbmdzLFxuICAgICAgLi4udGhpcy5nZXREZWZhdWx0QnJ1c2hTZXR0aW5ncygpLFxuICAgICAgLi4uc2V0dGluZ3NcbiAgICB9XG4gICAgaWYgKHRoaXMuc2V0dGluZ3MubWF4UG9pbnRzID09PSAwKSB7XG4gICAgICB0aGlzLnNldHRpbmdzLm1heFBvaW50cyA9IG1heCh0aGlzLmdyb3VwLmZsYXRNYXAoeCA9PiB4Lmxlbmd0aCkpIVxuICAgIH1cbiAgICBpZiAodGhpcy5zZXR0aW5ncy5tYXhMZW5ndGggPT09IDApIHtcbiAgICAgIHRoaXMuc2V0dGluZ3MubWF4TGVuZ3RoID0gbWF4KHRoaXMuZ3JvdXAubWFwKHggPT4gdGhpcy5nZXRMZW5ndGgoeCkpKSFcbiAgICB9XG4gICAgaWYgKHRoaXMuc2V0dGluZ3MubWF4Q3VydmVzID09PSAwKSB7XG4gICAgICB0aGlzLnNldHRpbmdzLm1heEN1cnZlcyA9IHRoaXMuZ3JvdXAubGVuZ3RoXG4gICAgfVxuICAgIGNvbnN0IHNpemUgPSB0aGlzLnJlbmRlcmVyLmdldERyYXdpbmdCdWZmZXJTaXplKG5ldyBWZWN0b3IyKCkpXG5cbiAgICB0aGlzLmluZm8gPSB7XG4gICAgICBpbnN0YW5jZXNQZXJDdXJ2ZTogTWF0aC5tYXgoXG4gICAgICAgIDEsXG4gICAgICAgIE1hdGguZmxvb3IoXG4gICAgICAgICAgdGhpcy5zZXR0aW5ncy5zcGFjaW5nVHlwZSA9PT0gJ3BpeGVsJ1xuICAgICAgICAgICAgPyAodGhpcy5zZXR0aW5ncy5tYXhMZW5ndGggKiBzaXplLndpZHRoKSAvIHRoaXMuc2V0dGluZ3Muc3BhY2luZ1xuICAgICAgICAgICAgOiB0aGlzLnNldHRpbmdzLnNwYWNpbmdUeXBlID09PSAnd2lkdGgnXG4gICAgICAgICAgICA/ICh0aGlzLnNldHRpbmdzLm1heExlbmd0aCAqIHNpemUud2lkdGgpIC9cbiAgICAgICAgICAgICAgKHRoaXMuc2V0dGluZ3Muc3BhY2luZyAqIHNpemUud2lkdGgpXG4gICAgICAgICAgICA6IHRoaXMuc2V0dGluZ3Muc3BhY2luZ1R5cGUgPT09ICdjb3VudCdcbiAgICAgICAgICAgID8gdGhpcy5zZXR0aW5ncy5zcGFjaW5nXG4gICAgICAgICAgICA6IDBcbiAgICAgICAgKVxuICAgICAgKSxcbiAgICAgIGN1cnZlUG9zaXRpb25BcnJheTogaW5zdGFuY2VkQXJyYXkoXG4gICAgICAgIHRoaXMuc2V0dGluZ3MubWF4UG9pbnRzICogdGhpcy5zZXR0aW5ncy5tYXhDdXJ2ZXMsXG4gICAgICAgICd2ZWM0J1xuICAgICAgKSxcbiAgICAgIGN1cnZlQ29sb3JBcnJheTogaW5zdGFuY2VkQXJyYXkoXG4gICAgICAgIHRoaXMuc2V0dGluZ3MubWF4UG9pbnRzICogdGhpcy5zZXR0aW5ncy5tYXhDdXJ2ZXMsXG4gICAgICAgICd2ZWM0J1xuICAgICAgKSxcbiAgICAgIGxvYWRQb3NpdGlvbnM6IHVuaWZvcm1BcnJheShcbiAgICAgICAgcmFuZ2UodGhpcy5zZXR0aW5ncy5tYXhQb2ludHMgKiB0aGlzLnNldHRpbmdzLm1heEN1cnZlcykubWFwKFxuICAgICAgICAgIHggPT4gbmV3IFZlY3RvcjQoKVxuICAgICAgICApLFxuICAgICAgICAndmVjNCdcbiAgICAgICksXG4gICAgICBsb2FkQ29sb3JzOiB1bmlmb3JtQXJyYXkoXG4gICAgICAgIHJhbmdlKHRoaXMuc2V0dGluZ3MubWF4UG9pbnRzICogdGhpcy5zZXR0aW5ncy5tYXhDdXJ2ZXMpLm1hcChcbiAgICAgICAgICB4ID0+IG5ldyBWZWN0b3I0KClcbiAgICAgICAgKSxcbiAgICAgICAgJ3ZlYzQnXG4gICAgICApLFxuICAgICAgY29udHJvbFBvaW50Q291bnRzOiB1bmlmb3JtQXJyYXkoXG4gICAgICAgIHRoaXMuZ3JvdXAubWFwKHggPT4geC5sZW5ndGgpLFxuICAgICAgICAnaW50J1xuICAgICAgKVxuICAgIH1cblxuICAgIHRoaXMuYWR2YW5jZUNvbnRyb2xQb2ludHMgPSBGbigoKSA9PiB7XG4gICAgICBjb25zdCBwb2ludEkgPSBpbnN0YW5jZUluZGV4Lm1vZChpbnQodGhpcy5zZXR0aW5ncy5tYXhQb2ludHMpKVxuICAgICAgY29uc3QgY3VydmVJID0gaW5zdGFuY2VJbmRleC5kaXYodGhpcy5zZXR0aW5ncy5tYXhQb2ludHMpXG4gICAgICBjb25zdCBpbmZvID0ge1xuICAgICAgICBwcm9ncmVzczogY3VydmVJXG4gICAgICAgICAgLnRvRmxvYXQoKVxuICAgICAgICAgIC5hZGQoXG4gICAgICAgICAgICBwb2ludElcbiAgICAgICAgICAgICAgLnRvRmxvYXQoKVxuICAgICAgICAgICAgICAuZGl2KHRoaXMuaW5mby5jb250cm9sUG9pbnRDb3VudHMuZWxlbWVudChjdXJ2ZUkpLnN1YigxKSlcbiAgICAgICAgICApLFxuICAgICAgICBidWlsZGVyOiB0aGlzLmdyb3VwXG4gICAgICB9XG4gICAgICBjb25zdCBpbmRleCA9IGN1cnZlSS5tdWwodGhpcy5zZXR0aW5ncy5tYXhQb2ludHMpLmFkZChwb2ludEkpXG4gICAgICBjb25zdCB0aGlzUG9zaXRpb24gPSB0aGlzLmluZm8ubG9hZFBvc2l0aW9ucy5lbGVtZW50KGluZGV4KVxuICAgICAgdGhpcy5pbmZvLmN1cnZlUG9zaXRpb25BcnJheS5lbGVtZW50KGluZGV4KS5hc3NpZ24oXG4gICAgICAgIHRoaXMuc2V0dGluZ3MuY3VydmVQb3NpdGlvbih0aGlzUG9zaXRpb24sIHtcbiAgICAgICAgICAuLi5pbmZvLFxuICAgICAgICAgIGxhc3RGcmFtZTogdGhpcy5pbmZvLmN1cnZlUG9zaXRpb25BcnJheS5lbGVtZW50KGluZGV4KVxuICAgICAgICB9KVxuICAgICAgKVxuICAgICAgY29uc3QgdGhpc0NvbG9yID0gdGhpcy5pbmZvLmxvYWRDb2xvcnMuZWxlbWVudChpbmRleClcbiAgICAgIHRoaXMuaW5mby5jdXJ2ZUNvbG9yQXJyYXkuZWxlbWVudChpbmRleCkuYXNzaWduKFxuICAgICAgICB0aGlzLnNldHRpbmdzLmN1cnZlQ29sb3IodGhpc0NvbG9yLCB7XG4gICAgICAgICAgLi4uaW5mbyxcbiAgICAgICAgICBsYXN0RnJhbWU6IHRoaXMuaW5mby5jdXJ2ZUNvbG9yQXJyYXkuZWxlbWVudChpbmRleClcbiAgICAgICAgfSlcbiAgICAgIClcbiAgICB9KSgpLmNvbXB1dGUodGhpcy5zZXR0aW5ncy5tYXhQb2ludHMgKiB0aGlzLnNldHRpbmdzLm1heEN1cnZlcylcblxuICAgIHRoaXMubG9hZENvbnRyb2xQb2ludHMgPSBGbigoKSA9PiB7XG4gICAgICB0aGlzLmluZm8uY3VydmVQb3NpdGlvbkFycmF5XG4gICAgICAgIC5lbGVtZW50KGluc3RhbmNlSW5kZXgpXG4gICAgICAgIC5hc3NpZ24odGhpcy5pbmZvLmxvYWRQb3NpdGlvbnMuZWxlbWVudChpbnN0YW5jZUluZGV4KSlcbiAgICAgIHRoaXMuaW5mby5jdXJ2ZUNvbG9yQXJyYXlcbiAgICAgICAgLmVsZW1lbnQoaW5zdGFuY2VJbmRleClcbiAgICAgICAgLmFzc2lnbih0aGlzLmluZm8ubG9hZENvbG9ycy5lbGVtZW50KGluc3RhbmNlSW5kZXgpKVxuICAgIH0pKCkuY29tcHV0ZSh0aGlzLnNldHRpbmdzLm1heEN1cnZlcyAqIHRoaXMuc2V0dGluZ3MubWF4UG9pbnRzKVxuXG4gICAgdGhpcy5uZXh0VGltZSA9XG4gICAgICAodHlwZW9mIHRoaXMuc2V0dGluZ3MucmVuZGVyU3RhcnQgPT09ICdmdW5jdGlvbidcbiAgICAgICAgPyB0aGlzLnNldHRpbmdzLnJlbmRlclN0YXJ0KClcbiAgICAgICAgOiB0aGlzLnNldHRpbmdzLnJlbmRlclN0YXJ0KSAvIDEwMDBcblxuICAgIHRoaXMub25Jbml0KClcbiAgICB0aGlzLmZyYW1lKDApXG5cbiAgICAvLyBpZiAodGhpcy5zZXR0aW5ncy5vbkNsaWNrKSB7XG4gICAgLy8gICB0aGlzLnJlbmRlcmVyLmRvbUVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihcbiAgICAvLyAgICAgJ2NsaWNrJyxcbiAgICAvLyAgICAgdGhpcy5vbkNsaWNrLmJpbmQodGhpcylcbiAgICAvLyAgIClcbiAgICAvLyB9XG4gICAgLy8gaWYgKHRoaXMuc2V0dGluZ3Mub25EcmFnKSB7XG4gICAgLy8gICB0aGlzLnJlbmRlcmVyLmRvbUVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihcbiAgICAvLyAgICAgJ21vdXNlbW92ZScsXG4gICAgLy8gICAgIHRoaXMub25EcmFnLmJpbmQodGhpcylcbiAgICAvLyAgIClcbiAgICAvLyB9XG4gICAgLy8gaWYgKHRoaXMuc2V0dGluZ3Mub25PdmVyKSB7XG4gICAgLy8gICB0aGlzLnJlbmRlcmVyLmRvbUVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihcbiAgICAvLyAgICAgJ21vdXNlbW92ZScsXG4gICAgLy8gICAgIHRoaXMub25PdmVyLmJpbmQodGhpcylcbiAgICAvLyAgIClcbiAgICAvLyB9XG4gICAgaWYgKHRoaXMuc2V0dGluZ3MubWF4UG9pbnRzID09PSAwKSB7XG4gICAgICB0aGlzLnNldHRpbmdzLm1heFBvaW50cyA9IG1heCh0aGlzLmdyb3VwLmZsYXRNYXAoeCA9PiB4Lmxlbmd0aCkpIVxuICAgIH1cbiAgICBpZiAodGhpcy5zZXR0aW5ncy5tYXhMZW5ndGggPT09IDApIHtcbiAgICAgIHRoaXMuc2V0dGluZ3MubWF4TGVuZ3RoID0gbWF4KHRoaXMuZ3JvdXAubWFwKHggPT4gdGhpcy5nZXRMZW5ndGgoeCkpKSFcbiAgICB9XG4gICAgaWYgKHRoaXMuc2V0dGluZ3MubWF4Q3VydmVzID09PSAwKSB7XG4gICAgICB0aGlzLnNldHRpbmdzLm1heEN1cnZlcyA9IHRoaXMuZ3JvdXAubGVuZ3RoXG4gICAgfVxuICAgIHRoaXMuaW5mbyA9IHtcbiAgICAgIGluc3RhbmNlc1BlckN1cnZlOiBNYXRoLm1heChcbiAgICAgICAgMSxcbiAgICAgICAgTWF0aC5mbG9vcihcbiAgICAgICAgICB0aGlzLnNldHRpbmdzLnNwYWNpbmdUeXBlID09PSAncGl4ZWwnXG4gICAgICAgICAgICA/ICh0aGlzLnNldHRpbmdzLm1heExlbmd0aCAqIHNpemUud2lkdGgpIC8gdGhpcy5zZXR0aW5ncy5zcGFjaW5nXG4gICAgICAgICAgICA6IHRoaXMuc2V0dGluZ3Muc3BhY2luZ1R5cGUgPT09ICd3aWR0aCdcbiAgICAgICAgICAgID8gKHRoaXMuc2V0dGluZ3MubWF4TGVuZ3RoICogc2l6ZS53aWR0aCkgL1xuICAgICAgICAgICAgICAodGhpcy5zZXR0aW5ncy5zcGFjaW5nICogc2l6ZS53aWR0aClcbiAgICAgICAgICAgIDogdGhpcy5zZXR0aW5ncy5zcGFjaW5nVHlwZSA9PT0gJ2NvdW50J1xuICAgICAgICAgICAgPyB0aGlzLnNldHRpbmdzLnNwYWNpbmdcbiAgICAgICAgICAgIDogMFxuICAgICAgICApXG4gICAgICApLFxuICAgICAgY3VydmVQb3NpdGlvbkFycmF5OiBpbnN0YW5jZWRBcnJheShcbiAgICAgICAgdGhpcy5zZXR0aW5ncy5tYXhQb2ludHMgKiB0aGlzLnNldHRpbmdzLm1heEN1cnZlcyxcbiAgICAgICAgJ3ZlYzQnXG4gICAgICApLFxuICAgICAgY3VydmVDb2xvckFycmF5OiBpbnN0YW5jZWRBcnJheShcbiAgICAgICAgdGhpcy5zZXR0aW5ncy5tYXhQb2ludHMgKiB0aGlzLnNldHRpbmdzLm1heEN1cnZlcyxcbiAgICAgICAgJ3ZlYzQnXG4gICAgICApLFxuICAgICAgbG9hZFBvc2l0aW9uczogdW5pZm9ybUFycmF5KFxuICAgICAgICByYW5nZSh0aGlzLnNldHRpbmdzLm1heFBvaW50cyAqIHRoaXMuc2V0dGluZ3MubWF4Q3VydmVzKS5tYXAoXG4gICAgICAgICAgeCA9PiBuZXcgVmVjdG9yNCgpXG4gICAgICAgICksXG4gICAgICAgICd2ZWM0J1xuICAgICAgKSxcbiAgICAgIGxvYWRDb2xvcnM6IHVuaWZvcm1BcnJheShcbiAgICAgICAgcmFuZ2UodGhpcy5zZXR0aW5ncy5tYXhQb2ludHMgKiB0aGlzLnNldHRpbmdzLm1heEN1cnZlcykubWFwKFxuICAgICAgICAgIHggPT4gbmV3IFZlY3RvcjQoKVxuICAgICAgICApLFxuICAgICAgICAndmVjNCdcbiAgICAgICksXG4gICAgICBjb250cm9sUG9pbnRDb3VudHM6IHVuaWZvcm1BcnJheShcbiAgICAgICAgdGhpcy5ncm91cC5tYXAoeCA9PiB4Lmxlbmd0aCksXG4gICAgICAgICdpbnQnXG4gICAgICApXG4gICAgfVxuXG4gICAgdGhpcy5hZHZhbmNlQ29udHJvbFBvaW50cyA9IEZuKCgpID0+IHtcbiAgICAgIGNvbnN0IHBvaW50SSA9IGluc3RhbmNlSW5kZXgubW9kSW50KHRoaXMuc2V0dGluZ3MubWF4UG9pbnRzKVxuICAgICAgY29uc3QgY3VydmVJID0gaW5zdGFuY2VJbmRleC5kaXYodGhpcy5zZXR0aW5ncy5tYXhQb2ludHMpXG4gICAgICBjb25zdCBpbmZvID0ge1xuICAgICAgICBwcm9ncmVzczogY3VydmVJXG4gICAgICAgICAgLnRvRmxvYXQoKVxuICAgICAgICAgIC5hZGQoXG4gICAgICAgICAgICBwb2ludElcbiAgICAgICAgICAgICAgLnRvRmxvYXQoKVxuICAgICAgICAgICAgICAuZGl2KHRoaXMuaW5mby5jb250cm9sUG9pbnRDb3VudHMuZWxlbWVudChjdXJ2ZUkpLnN1YigxKSlcbiAgICAgICAgICApLFxuICAgICAgICBidWlsZGVyOiB0aGlzLmdyb3VwXG4gICAgICB9XG4gICAgICBjb25zdCBpbmRleCA9IGN1cnZlSS5tdWwodGhpcy5zZXR0aW5ncy5tYXhQb2ludHMpLmFkZChwb2ludEkpXG4gICAgICBjb25zdCB0aGlzUG9zaXRpb24gPSB0aGlzLmluZm8ubG9hZFBvc2l0aW9ucy5lbGVtZW50KGluZGV4KVxuXG4gICAgICB0aGlzLmluZm8uY3VydmVQb3NpdGlvbkFycmF5LmVsZW1lbnQoaW5kZXgpLmFzc2lnbihcbiAgICAgICAgdGhpcy5zZXR0aW5ncy5jdXJ2ZVBvc2l0aW9uKHRoaXNQb3NpdGlvbiwge1xuICAgICAgICAgIC4uLmluZm8sXG4gICAgICAgICAgbGFzdEZyYW1lOiB0aGlzLmluZm8uY3VydmVQb3NpdGlvbkFycmF5LmVsZW1lbnQoaW5kZXgpXG4gICAgICAgIH0pXG4gICAgICApXG4gICAgICBjb25zdCB0aGlzQ29sb3IgPSB0aGlzLmluZm8ubG9hZENvbG9ycy5lbGVtZW50KGluZGV4KVxuICAgICAgdGhpcy5pbmZvLmN1cnZlQ29sb3JBcnJheS5lbGVtZW50KGluZGV4KS5hc3NpZ24oXG4gICAgICAgIHRoaXMuc2V0dGluZ3MuY3VydmVDb2xvcih0aGlzQ29sb3IsIHtcbiAgICAgICAgICAuLi5pbmZvLFxuICAgICAgICAgIGxhc3RGcmFtZTogdGhpcy5pbmZvLmN1cnZlQ29sb3JBcnJheS5lbGVtZW50KGluZGV4KVxuICAgICAgICB9KVxuICAgICAgKVxuICAgIH0pKCkuY29tcHV0ZSh0aGlzLnNldHRpbmdzLm1heFBvaW50cyAqIHRoaXMuc2V0dGluZ3MubWF4Q3VydmVzKVxuXG4gICAgdGhpcy5sb2FkQ29udHJvbFBvaW50cyA9IEZuKCgpID0+IHtcbiAgICAgIHRoaXMuaW5mby5jdXJ2ZVBvc2l0aW9uQXJyYXlcbiAgICAgICAgLmVsZW1lbnQoaW5zdGFuY2VJbmRleClcbiAgICAgICAgLmFzc2lnbih0aGlzLmluZm8ubG9hZFBvc2l0aW9ucy5lbGVtZW50KGluc3RhbmNlSW5kZXgpKVxuICAgICAgdGhpcy5pbmZvLmN1cnZlQ29sb3JBcnJheVxuICAgICAgICAuZWxlbWVudChpbnN0YW5jZUluZGV4KVxuICAgICAgICAuYXNzaWduKHRoaXMuaW5mby5sb2FkQ29sb3JzLmVsZW1lbnQoaW5zdGFuY2VJbmRleCkpXG4gICAgfSkoKS5jb21wdXRlKHRoaXMuc2V0dGluZ3MubWF4Q3VydmVzICogdGhpcy5zZXR0aW5ncy5tYXhQb2ludHMpXG5cbiAgICB0aGlzLm5leHRUaW1lID1cbiAgICAgICh0eXBlb2YgdGhpcy5zZXR0aW5ncy5yZW5kZXJTdGFydCA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICA/IHRoaXMuc2V0dGluZ3MucmVuZGVyU3RhcnQoKVxuICAgICAgICA6IHRoaXMuc2V0dGluZ3MucmVuZGVyU3RhcnQpIC8gMTAwMFxuXG4gICAgdGhpcy5vbkluaXQoKVxuICAgIHRoaXMuZnJhbWUoMClcblxuICAgIC8vIGlmICh0aGlzLnNldHRpbmdzLm9uQ2xpY2spIHtcbiAgICAvLyAgIHRoaXMucmVuZGVyZXIuZG9tRWxlbWVudC5hZGRFdmVudExpc3RlbmVyKFxuICAgIC8vICAgICAnY2xpY2snLFxuICAgIC8vICAgICB0aGlzLm9uQ2xpY2suYmluZCh0aGlzKVxuICAgIC8vICAgKVxuICAgIC8vIH1cbiAgICAvLyBpZiAodGhpcy5zZXR0aW5ncy5vbkRyYWcpIHtcbiAgICAvLyAgIHRoaXMucmVuZGVyZXIuZG9tRWxlbWVudC5hZGRFdmVudExpc3RlbmVyKFxuICAgIC8vICAgICAnbW91c2Vtb3ZlJyxcbiAgICAvLyAgICAgdGhpcy5vbkRyYWcuYmluZCh0aGlzKVxuICAgIC8vICAgKVxuICAgIC8vIH1cbiAgICAvLyBpZiAodGhpcy5zZXR0aW5ncy5vbk92ZXIpIHtcbiAgICAvLyAgIHRoaXMucmVuZGVyZXIuZG9tRWxlbWVudC5hZGRFdmVudExpc3RlbmVyKFxuICAgIC8vICAgICAnbW91c2Vtb3ZlJyxcbiAgICAvLyAgICAgdGhpcy5vbk92ZXIuYmluZCh0aGlzKVxuICAgIC8vICAgKVxuICAgIC8vIH1cbiAgfVxufVxuIl19