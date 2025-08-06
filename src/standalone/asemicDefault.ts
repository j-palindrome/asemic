export default `---h=16/9
this
.def('scale', '.3')
.def('spd', '.1')
.def('shrink', '1')
.def('a', '~')
.def('rpt', '100')
.def('flame', '0')
.def('rotMag', '.1~')
.def('rotScale', '.1#')
.def('lineWidth', '1')
.fnt('trees', {
  'q,w,e,r,t,y': (p, {i, n}) => p.crv(\`@.5<\${i}+1/\${n}>1*rotMag,1\`,{add:true}),
  'a,s,d,f,g,h': (p, {i, n}) => p.crv(\`@.5*rotMag<\${i}/\${n}>0,1\`,{add:true}),
  '\\\\.': (p) => this.tra('@spd-.5*rotScale *shrink'),
  '\\\\s': () => p.end().crv('0,0', {add:true}),
  '\\\\^': (p) => p.crv('0,0', {add:true}),
  '\\\\$': (p) => p.end()
})

---
this
.fnt('trees')
.tra('! h=.6 l=.5 s=.3 a=a w=lineWidth +0,.4*H *2 *scale @.5 >')
.rpt('rpt', () => this.tra('< > @.2*I/N +(.1~-.5)*flame').txt('tdtgfr'))

.fnt('default')
.tra('! s=0 l=1 a=1 +32*px,.2 *2 *48*px w=1<P>3>2')
.txt(
\`{*1.5}Soundscreen:\\\\ \\\\
{+1,0 >}Silent Video\\\\
      and\\\\
Live\\\\
         Sound\\\\
{! +.1,.6*H *2 *80*px w=8 >} {*.6 w=6}monday\\\\JULY 7
{! +0,.8*H *2 *32*px w=2 >}    MILLENIUM FILM WORKSHOP\\\\
167 WILSON AVE (BUSHWICK)\\\\
          8 pm\`)`
