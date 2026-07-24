var skullRunning = false;
var skullRafId = null;
var skullAx = 0, skullAy = 0;
var skullCharAspect = 0.55;
var SW = 80, SH = 42;
var SCHARS = ' `.,:;i+xX$&#@';

function vlen(v) { return Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]); }
function vnrm(v) { var l=vlen(v); return [v[0]/l,v[1]/l,v[2]/l]; }
function vdot(a,b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }

function sdEllipsoid(p, r) {
    var k0 = vlen([p[0]/r[0], p[1]/r[1], p[2]/r[2]]);
    var k1 = vlen([p[0]/(r[0]*r[0]), p[1]/(r[1]*r[1]), p[2]/(r[2]*r[2])]);
    return k0*(k0-1.0)/k1;
}

function sdSphere(p, r) { return vlen(p) - r; }

function sdBox(p, b) {
    var qx=Math.abs(p[0])-b[0], qy=Math.abs(p[1])-b[1], qz=Math.abs(p[2])-b[2];
    return vlen([Math.max(qx,0),Math.max(qy,0),Math.max(qz,0)]) + Math.min(Math.max(qx,Math.max(qy,qz)),0);
}

function opUnion(a,b) { return Math.min(a,b); }
function opSub(a,b)   { return Math.max(a,-b); }
function opSmooth(a,b,k) {
    var h = Math.max(k-Math.abs(a-b),0)/k;
    return Math.min(a,b)-h*h*k*0.25;
}

function skullSDF(p) {
    var px=p[0], py=p[1], pz=p[2];

    // Cranium dome
    var d = sdEllipsoid([px, py-0.16, pz], [0.78, 0.78, 0.65]);

    // Temporal fossae — hollow the sides so it narrows at cheekbone level
    d = opSub(d, sdEllipsoid([px+0.80, py-0.05, pz+0.05], [0.17, 0.40, 0.46]));
    d = opSub(d, sdEllipsoid([px-0.80, py-0.05, pz+0.05], [0.17, 0.40, 0.46]));

    // Upper face / maxilla
    d = opSmooth(d, sdEllipsoid([px, py+0.44, pz-0.02], [0.54, 0.28, 0.50]), 0.07);

    // Mandible
    d = opSmooth(d, sdEllipsoid([px, py+0.76, pz], [0.40, 0.18, 0.36]), 0.06);

    // Eye orbits — large ellipsoids, the dominant feature
    d = opSub(d, sdEllipsoid([px+0.27, py-0.08, pz-0.50], [0.225, 0.195, 0.17]));
    d = opSub(d, sdEllipsoid([px-0.27, py-0.08, pz-0.50], [0.225, 0.195, 0.17]));

    // Nasal aperture — pear shape (sphere + ellipsoid)
    d = opSub(d, opUnion(
        sdSphere([px, py+0.18, pz-0.57], 0.098),
        sdEllipsoid([px, py+0.30, pz-0.57], [0.068, 0.12, 0.078])
    ));

    // Mouth gap
    d = opSub(d, sdBox([px, py+0.47, pz-0.41], [0.26, 0.046, 0.112]));

    // Tooth slots (4 gaps = 5 teeth)
    for (var i=0; i<4; i++) {
        d = opSub(d, sdBox([px-(-0.15+i*0.100), py+0.434, pz-0.445], [0.022, 0.054, 0.108]));
    }

    return d;
}

function rotXs(p,a){ var c=Math.cos(a),s=Math.sin(a); return [p[0],p[1]*c-p[2]*s,p[1]*s+p[2]*c]; }
function rotYs(p,a){ var c=Math.cos(a),s=Math.sin(a); return [p[0]*c+p[2]*s,p[1],-p[0]*s+p[2]*c]; }

function sdf(p) { return skullSDF(rotYs(rotXs(p,-skullAx),-skullAy)); }

function getNormal(p) {
    var e=0.002, d=sdf(p);
    return vnrm([sdf([p[0]+e,p[1],p[2]])-d, sdf([p[0],p[1]+e,p[2]])-d, sdf([p[0],p[1],p[2]+e])-d]);
}

function march(ro, rd) {
    var t=0.1;
    for (var i=0; i<80; i++) {
        var d=sdf([ro[0]+rd[0]*t, ro[1]+rd[1]*t, ro[2]+rd[2]*t]);
        if (d<0.002) return t;
        if (t>6.0) return -1;
        t+=d;
    }
    return -1;
}

var skullLight = vnrm([0.8, 1.4, 2.0]);

function measureSkullAspect() {
    var el=document.createElement('pre');
    el.style.cssText="font-family:'Courier New',monospace;font-size:15px;line-height:1em;letter-spacing:0.05em;position:absolute;visibility:hidden;white-space:pre";
    el.textContent='X\nX';
    document.body.appendChild(el);
    var r=el.getBoundingClientRect();
    document.body.removeChild(el);
    return (r.width>0&&r.height>0) ? r.width/(r.height/2) : 0.55;
}

function skullFrame() {
    if (!skullRunning) return;
    var pre=document.getElementById('anim-pre');
    var CAM_Z=1.5, FOV=0.95;
    var out='';
    for (var sy=0; sy<SH; sy++) {
        for (var sx=0; sx<SW; sx++) {
            var u=(sx/SW-0.5)*2.0*FOV;
            var v=-(sy/SH-0.5)*2.0*FOV/skullCharAspect;
            var ro=[0,0,CAM_Z];
            var rd=vnrm([u,v,-1.8]);
            var t=march(ro,rd);
            if (t<0) {
                out+=' ';
            } else {
                var hp=[ro[0]+rd[0]*t,ro[1]+rd[1]*t,ro[2]+rd[2]*t];
                var n=getNormal(hp);
                var diff=Math.max(0,vdot(n,skullLight));
                var spec=Math.pow(Math.max(0,vdot(vnrm([skullLight[0]-rd[0],skullLight[1]-rd[1],skullLight[2]-rd[2]]),n)),6)*0.3;
                var b=Math.min(0.9999, 0.10+0.75*diff+spec);
                out+=SCHARS[Math.floor(b*SCHARS.length)];
            }
        }
        out+='\n';
    }
    pre.textContent=out;
    skullAy+=0.012;
    skullAx+=0.004;
    skullRafId=requestAnimationFrame(skullFrame);
}

window.startSkull=function(){
    skullCharAspect=measureSkullAspect();
    skullRunning=true;
    skullRafId=requestAnimationFrame(skullFrame);
};
window.stopSkull=function(){
    skullRunning=false;
    if(skullRafId) cancelAnimationFrame(skullRafId);
};
