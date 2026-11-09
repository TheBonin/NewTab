// Shrink the ASCII scene so it never spills out of the area above the shortcuts
function fitAnim() {
    var wrap = document.getElementById('anim-wrap');
    var pre = document.getElementById('anim-pre');
    if (!pre.offsetWidth || !pre.offsetHeight) return;
    var scale = Math.min(1, wrap.clientWidth / pre.offsetWidth, wrap.clientHeight / pre.offsetHeight);
    pre.style.transform = 'scale(' + scale + ')';
}

document.addEventListener('DOMContentLoaded', function() {
    window.startCube();
    // Refit whenever the area resizes or the scene first gets its size
    var observer = new ResizeObserver(fitAnim);
    observer.observe(document.getElementById('anim-wrap'));
    observer.observe(document.getElementById('anim-pre'));
});
