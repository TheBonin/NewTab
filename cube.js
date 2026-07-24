var W = 80, H = 42;
var CHARS = ' `.,:;i+xX$&#@';
var ax = 0, ay = 0, az = 0;
var charAspect = 0.55;
var cubeRunning = false;
var cubeRafId = null;

function measureCharAspect() {
    var el = document.createElement('pre');
    el.style.cssText = "font-family:'Courier New',monospace;font-size:15px;line-height:1em;letter-spacing:0.05em;position:absolute;visibility:hidden;white-space:pre";
    el.textContent = 'X\nX';
    document.body.appendChild(el);
    var r = el.getBoundingClientRect();
    document.body.removeChild(el);
    return (r.width > 0 && r.height > 0) ? r.width / (r.height / 2) : 0.55;
}

function rot(x, y, z, rx, ry, rz) {
    var y1 = y * Math.cos(rx) - z * Math.sin(rx);
    var z1 = y * Math.sin(rx) + z * Math.cos(rx);
    var x2 = x * Math.cos(ry) + z1 * Math.sin(ry);
    var z2 = -x * Math.sin(ry) + z1 * Math.cos(ry);
    var x3 = x2 * Math.cos(rz) - y1 * Math.sin(rz);
    var y3 = x2 * Math.sin(rz) + y1 * Math.cos(rz);
    return [x3, y3, z2];
}

function project(x, y, z) {
    var D = 5;
    var s = D / (z + D + 3);
    return [
        Math.round(x * s * W * 0.38 + W / 2),
        Math.round(-y * s * W * 0.38 * charAspect + H / 2)
    ];
}

function nrm(v) {
    var l = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
    return [v[0]/l, v[1]/l, v[2]/l];
}

var light = nrm([1, 2, -3]);

var faces = [
    { n: [ 0,  0, -1], p: function(u,v) { return [ u,  v, -1]; } },
    { n: [ 0,  0,  1], p: function(u,v) { return [ u,  v,  1]; } },
    { n: [ 0, -1,  0], p: function(u,v) { return [ u, -1,  v]; } },
    { n: [ 0,  1,  0], p: function(u,v) { return [ u,  1,  v]; } },
    { n: [-1,  0,  0], p: function(u,v) { return [-1,  v,  u]; } },
    { n: [ 1,  0,  0], p: function(u,v) { return [ 1,  v,  u]; } },
];

var STEPS = 55;

function cubeFrame() {
    if (!cubeRunning) return;
    var pre = document.getElementById('anim-pre');
    var buf = new Array(W * H).fill(' ');
    var zbuf = new Array(W * H).fill(Infinity);

    for (var fi = 0; fi < faces.length; fi++) {
        var face = faces[fi];
        var rn = rot(face.n[0], face.n[1], face.n[2], ax, ay, az);
        if (rn[2] >= 0) continue;

        var dot = rn[0]*light[0] + rn[1]*light[1] + rn[2]*light[2];
        var brightness = 0.15 + 0.85 * Math.max(0, dot);
        var ch = CHARS[Math.floor(brightness * (CHARS.length - 1))];

        for (var ui = 0; ui <= STEPS; ui++) {
            for (var vi = 0; vi <= STEPS; vi++) {
                var u = (ui / STEPS) * 2 - 1;
                var v = (vi / STEPS) * 2 - 1;
                var fp = face.p(u, v);
                var rp = rot(fp[0], fp[1], fp[2], ax, ay, az);
                var sp = project(rp[0], rp[1], rp[2]);
                var sx = sp[0], sy = sp[1];
                if (sx < 0 || sx >= W || sy < 0 || sy >= H) continue;
                var idx = sy * W + sx;
                if (rp[2] < zbuf[idx]) {
                    zbuf[idx] = rp[2];
                    buf[idx] = ch;
                }
            }
        }
    }

    var out = '';
    for (var y = 0; y < H; y++) {
        out += buf.slice(y * W, y * W + W).join('') + '\n';
    }
    pre.textContent = out;

    ax += 0.010;
    ay += 0.014;
    az += 0.007;
    cubeRafId = requestAnimationFrame(cubeFrame);
}

window.startCube = function() {
    charAspect = measureCharAspect();
    cubeRunning = true;
    cubeRafId = requestAnimationFrame(cubeFrame);
};

window.stopCube = function() {
    cubeRunning = false;
    if (cubeRafId) cancelAnimationFrame(cubeRafId);
};
