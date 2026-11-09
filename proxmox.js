// Live Proxmox panel: polls /cluster/resources with a read-only API token from config.js
(() => {
    const GB = 1024 ** 3;
    // Usage at or above this share of CPU, RAM or disk is flagged in amber
    const HIGH_USAGE = 0.8;
    const SVG_NS = 'http://www.w3.org/2000/svg';

    // Proxmox RRD timeframes offered in the chart
    const PERIODS = [['hour', '1H'], ['day', '24H'], ['week', '7D']];
    // How long a guest's history is reused before asking Proxmox again
    const HISTORY_TTL = 60 * 1000;

    let activeConfig = null;

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function svg(tag, attrs) {
        const node = document.createElementNS(SVG_NS, tag);
        for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
        return node;
    }

    function formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    }

    function meter(label, ratio, value) {
        const percent = Math.max(0, Math.min(100, ratio * 100));
        const wrap = el('div', 'pve-meter' + (ratio >= HIGH_USAGE ? ' is-high' : ''));
        const head = el('div', 'pve-meter-head mono');
        head.append(el('span', '', label), el('span', 'pve-meter-value', value));
        const track = el('div', 'pve-meter-track');
        const fill = el('div', 'pve-meter-fill');
        fill.style.width = `${percent}%`;
        track.append(fill);
        wrap.append(head, track);
        return wrap;
    }

    function setStatus(text, isError) {
        const status = document.getElementById('pve-status');
        status.textContent = text;
        status.classList.toggle('is-error', Boolean(isError));
    }

    function renderProxmox(resources, nodeName) {
        const node = resources.find(r => r.type === 'node' && (!nodeName || r.node === nodeName))
            || resources.find(r => r.type === 'node');
        const meters = document.getElementById('pve-meters');
        const guests = document.getElementById('pve-guests');
        meters.replaceChildren();
        guests.replaceChildren();

        if (!node) {
            setStatus('nó não encontrado', true);
            return;
        }

        document.getElementById('pve-title').textContent = `// Proxmox · ${node.node}`;
        if (node.status === 'online') {
            setStatus(`online · up ${formatUptime(node.uptime)}`);
        } else {
            setStatus(node.status, true);
        }

        meters.append(
            meter('CPU', node.cpu, `${(node.cpu * 100).toFixed(0)}%`),
            meter('RAM', node.mem / node.maxmem, `${(node.mem / GB).toFixed(1)}/${(node.maxmem / GB).toFixed(0)} GB`),
            meter('Disco', node.disk / node.maxdisk, `${(node.disk / GB).toFixed(0)}/${(node.maxdisk / GB).toFixed(0)} GB`)
        );

        // Running guests first, then by VMID
        const list = resources
            .filter(r => (r.type === 'lxc' || r.type === 'qemu') && r.node === node.node && !r.template)
            .sort((a, b) => (a.status === 'running' ? 0 : 1) - (b.status === 'running' ? 0 : 1) || a.vmid - b.vmid);

        // Forget an opened guest that no longer exists so the list comes back
        if (!list.some(g => g.vmid === openVmid)) openVmid = null;
        guests.classList.toggle('has-open', openVmid !== null);

        for (const guest of list) {
            guests.append(guestRow(guest));
        }
    }

    // The one VMID the user opened; kept so the periodic refresh does not collapse it
    let openVmid = null;
    let openPeriod = 'hour';
    // Last history fetched, reused across the 10s re-renders
    let history = { key: null, points: null, error: null, fetchedAt: 0 };

    function historyKey(guest) {
        return `${guest.type}/${guest.vmid}:${openPeriod}`;
    }

    async function loadHistory(guest, force) {
        const key = historyKey(guest);
        if (!activeConfig) return;
        if (!force && history.key === key && Date.now() - history.fetchedAt < HISTORY_TTL) return;
        try {
            const points = await pveGet(activeConfig,
                `/nodes/${guest.node}/${guest.type}/${guest.vmid}/rrddata?timeframe=${openPeriod}&cf=AVERAGE`);
            history = { key, points, error: null, fetchedAt: Date.now() };
        } catch (error) {
            console.error('Proxmox:', error);
            history = { key, points: null, error: error instanceof TypeError ? 'sem conexão' : error.message, fetchedAt: Date.now() };
        }
        const block = document.querySelector('.pve-guest.is-open .pve-history');
        if (block && openVmid === guest.vmid) drawCharts(block, guest);
    }

    // Splits samples into runs of [x, y] in a 0..100 box, breaking where Proxmox has no sample
    function segments(points, t0, t1, value) {
        const runs = [];
        let run = null;
        for (const p of points) {
            const v = value(p);
            if (!Number.isFinite(v)) { run = null; continue; }
            if (!run) runs.push(run = []);
            run.push([((p.time - t0) / (t1 - t0 || 1)) * 100, 100 - Math.max(0, Math.min(1, v)) * 100]);
        }
        return runs;
    }

    function linePath(runs) {
        return runs.map(run => run.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join('')).join('');
    }

    function areaPath(runs) {
        return runs.map(run => `M${run[0][0].toFixed(2)},100` + run.map(([x, y]) => `L${x.toFixed(2)},${y.toFixed(2)}`).join('')
            + `L${run[run.length - 1][0].toFixed(2)},100Z`).join('');
    }

    // The three charts shown for an opened guest: label, sample value (0..1), live readout
    // and how a single sample reads in the hover tooltip
    function chartSeries(guest) {
        const running = guest.status === 'running';
        const isVm = guest.type === 'qemu';
        return [
            ['cpu', 'CPU', p => p.cpu,
                running ? `${(guest.cpu * 100).toFixed(0)}%` : '--',
                p => `${(p.cpu * 100).toFixed(1)}%`],
            ['ram', 'RAM', p => p.mem / p.maxmem,
                running ? `${(guest.mem / GB).toFixed(1)}/${(guest.maxmem / GB).toFixed(1)} GB` : '--',
                p => `${(p.mem / GB).toFixed(2)}/${(p.maxmem / GB).toFixed(1)} GB`],
            // Proxmox does not report disk usage for VMs, only their size
            ['disk', 'Disco', isVm ? null : p => p.disk / p.maxdisk,
                !guest.maxdisk ? '--'
                    : isVm ? `${(guest.maxdisk / GB).toFixed(0)} GB`
                    : `${(guest.disk / GB).toFixed(1)}/${(guest.maxdisk / GB).toFixed(0)} GB`,
                p => `${(p.disk / GB).toFixed(2)}/${(p.maxdisk / GB).toFixed(0)} GB`]
        ];
    }

    function formatSampleTime(seconds) {
        const date = new Date(seconds * 1000);
        const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        // Past a day the hour alone is ambiguous, so the week view adds the date
        return openPeriod === 'week'
            ? `${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${time}`
            : time;
    }

    // Vertical guide, dot and tooltip that follow the mouse to the nearest sample
    function attachHover(container, points, t0, t1, value, describe) {
        const samples = points.filter(p => Number.isFinite(value(p)));
        const line = el('div', 'pve-hover-line');
        const dot = el('div', 'pve-hover-dot');
        const tip = el('div', 'pve-hover-tip mono');
        container.append(line, dot, tip);

        container.onmousemove = event => {
            const box = container.getBoundingClientRect();
            const target = t0 + ((event.clientX - box.left) / box.width) * (t1 - t0);
            let nearest = samples[0];
            for (const p of samples) {
                if (Math.abs(p.time - target) < Math.abs(nearest.time - target)) nearest = p;
            }
            if (!nearest) return;

            const x = ((nearest.time - t0) / (t1 - t0 || 1)) * box.width;
            const y = (1 - Math.max(0, Math.min(1, value(nearest)))) * box.height;
            line.style.left = `${x}px`;
            dot.style.left = `${x}px`;
            dot.style.top = `${y}px`;
            tip.textContent = `${formatSampleTime(nearest.time)} · ${describe(nearest)}`;
            // Keep the tooltip inside the chart near the right edge
            tip.classList.toggle('is-left', x > box.width - 160);
            tip.style.left = `${x}px`;
            container.classList.add('is-hover');
        };
        container.onmouseleave = () => container.classList.remove('is-hover');
    }

    function drawCharts(block, guest) {
        const charts = block.querySelectorAll('.pve-chart');
        const series = chartSeries(guest);
        const loading = history.key !== historyKey(guest) || (!history.points && !history.error);
        const points = history.points
            ? history.points.filter(p => Number.isFinite(p.time)).sort((a, b) => a.time - b.time)
            : [];

        series.forEach(([key, , value, , describe], i) => {
            const container = charts[i];
            container.replaceChildren();
            container.onmousemove = null;
            container.classList.remove('is-hover');
            const message = loading ? 'carregando…'
                : history.error ? history.error
                : points.length < 2 ? 'sem histórico'
                : !value ? 'não informado para VMs'
                : null;
            if (message) {
                container.append(el('div', 'pve-chart-msg mono' + (history.error && !loading ? ' is-error' : ''), message));
                return;
            }

            const t0 = points[0].time;
            const t1 = points[points.length - 1].time;
            const chart = svg('svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'none' });
            const gradient = svg('linearGradient', { id: `pve-fill-${key}`, x1: '0', y1: '0', x2: '0', y2: '1' });
            gradient.append(
                svg('stop', { offset: '0%', 'stop-color': '#00ffa3', 'stop-opacity': '0.25' }),
                svg('stop', { offset: '100%', 'stop-color': '#00ffa3', 'stop-opacity': '0' })
            );
            const defs = svg('defs', {});
            defs.append(gradient);
            chart.append(defs);

            for (const y of [25, 50, 75]) {
                chart.append(svg('line', { x1: 0, x2: 100, y1: y, y2: y, class: 'pve-chart-grid' }));
            }

            const runs = segments(points, t0, t1, value);
            chart.append(
                svg('path', { d: areaPath(runs), class: 'pve-chart-area', fill: `url(#pve-fill-${key})` }),
                svg('path', { d: linePath(runs), class: 'pve-chart-line' })
            );
            container.append(chart);
            attachHover(container, points, t0, t1, value, describe);
        });
    }

    function historyBlock(guest) {
        const block = el('div', 'pve-history');

        const head = el('div', 'pve-history-head mono');
        const periods = el('div', 'pve-periods');
        for (const [value, label] of PERIODS) {
            const button = el('button', 'mono' + (value === openPeriod ? ' is-active' : ''), label);
            button.type = 'button';
            button.addEventListener('click', () => {
                openPeriod = value;
                for (const other of periods.children) other.classList.toggle('is-active', other === button);
                drawCharts(block, guest);
                loadHistory(guest, true);
            });
            periods.append(button);
        }
        head.append(el('span', '', 'Histórico'), periods);

        const charts = el('div', 'pve-charts');
        const current = usage(guest);
        for (const [key, label, , readout] of chartSeries(guest)) {
            const item = el('div', 'pve-chart-block');
            const title = el('div', 'pve-chart-title mono');
            title.append(el('span', '', label), el('b', current[key] >= HIGH_USAGE ? 'is-high' : '', readout));
            item.append(el('div', 'pve-chart'), title);
            charts.append(item);
        }

        block.append(head, charts);
        drawCharts(block, guest);
        return block;
    }

    function detail(label, value) {
        const cell = el('div', 'pve-detail');
        cell.append(el('span', 'pve-detail-label', label), el('span', 'pve-detail-value', value));
        return cell;
    }

    // Current CPU, RAM and disk shares of a running guest (VMs report no disk usage)
    function usage(guest) {
        if (guest.status !== 'running') return { cpu: 0, ram: 0, disk: 0 };
        return {
            cpu: guest.cpu,
            ram: guest.maxmem ? guest.mem / guest.maxmem : 0,
            disk: guest.type !== 'qemu' && guest.maxdisk ? guest.disk / guest.maxdisk : 0
        };
    }

    function isHighUsage(guest) {
        return Object.values(usage(guest)).some(ratio => ratio >= HIGH_USAGE);
    }

    function guestRow(guest) {
        const running = guest.status === 'running';
        const row = el('div', 'pve-guest' + (running ? '' : ' is-stopped') + (isHighUsage(guest) ? ' is-high' : '')
            + (openVmid === guest.vmid ? ' is-open' : ''));

        const head = el('button', 'pve-guest-head');
        head.type = 'button';
        // Amber "!" beside the name when CPU, RAM or disk is at 80%+; hovering it says which
        const alert = el('span', 'pve-alert mono', '!');
        alert.title = Object.entries(usage(guest))
            .filter(([, ratio]) => ratio >= HIGH_USAGE)
            .map(([key, ratio]) => `${{ cpu: 'CPU', ram: 'RAM', disk: 'Disco' }[key]} ${(ratio * 100).toFixed(0)}%`)
            .join(' · ');

        head.append(
            el('span', 'pve-dot'),
            el('span', 'pve-guest-name', guest.name || `${guest.type}-${guest.vmid}`),
            alert,
            el('span', 'pve-close mono', 'fechar ×')
        );
        // Opening a guest hides the others; it has to be closed before picking another
        head.addEventListener('click', event => {
            // Once open, only the Fechar button closes it; the rest of the row is inert
            if (openVmid === guest.vmid && !event.target.closest('.pve-close')) return;
            openVmid = openVmid === guest.vmid ? null : guest.vmid;
            row.classList.toggle('is-open', openVmid !== null);
            row.parentElement.classList.toggle('has-open', openVmid !== null);
            if (openVmid !== null) {
                drawCharts(row.querySelector('.pve-history'), guest);
                loadHistory(guest);
            }
        });

        const info = el('div', 'pve-guest-info mono');
        info.append(
            detail('ID', `${guest.vmid} · ${guest.type === 'qemu' ? 'VM' : 'LXC'}`),
            detail('Status', running ? `up ${formatUptime(guest.uptime || 0)}` : 'parado'),
            detail('Núcleos', String(guest.maxcpu || '--'))
        );

        const details = el('div', 'pve-guest-details');
        details.append(info, historyBlock(guest));

        row.append(head, details);
        if (openVmid === guest.vmid) loadHistory(guest);
        return row;
    }

    async function pveGet(config, path) {
        const response = await fetch(`${config.host}/api2/json${path}`, {
            headers: { 'Authorization': `PVEAPIToken=${config.tokenId}=${config.tokenSecret}` },
            cache: 'no-store'
        });
        if (response.status === 401) throw new Error('token inválido');
        if (response.status === 403) throw new Error('token sem permissão');
        if (!response.ok) throw new Error(`erro ${response.status}`);
        return (await response.json()).data;
    }

    // A click outside the opened guest's area closes it. The header's dark backdrop (its ::before)
    // bleeds past the panel, and clicks on it land on the header, so the header counts as inside
    document.addEventListener('click', event => {
        if (openVmid === null || event.target.closest('.hero header')) return;
        openVmid = null;
        document.querySelectorAll('.pve-guest.is-open').forEach(row => row.classList.remove('is-open'));
        document.getElementById('pve-guests').classList.remove('has-open');
    });

    window.renderProxmox = renderProxmox;

    document.addEventListener('DOMContentLoaded', () => {
        const config = window.PVE_CONFIG;
        if (!config || !config.tokenSecret) {
            setStatus('configure o config.js', true);
            return;
        }
        activeConfig = config;

        async function update() {
            try {
                renderProxmox(await pveGet(config, '/cluster/resources'), config.node);
            } catch (error) {
                console.error('Proxmox:', error);
                // A network or certificate failure surfaces as a TypeError from fetch
                setStatus(error instanceof TypeError ? 'sem conexão' : error.message, true);
            }
        }

        update();
        setInterval(update, (config.refreshSeconds || 10) * 1000);
    });
})();
