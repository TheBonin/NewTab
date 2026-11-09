document.addEventListener("DOMContentLoaded", () => {
    const clockElement = document.getElementById('clock');
    const weekdayElement = document.getElementById('weekday');
    const dateElement = document.getElementById('date');

    function updateClock() {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        clockElement.textContent = `${hours}:${minutes}`;

        weekdayElement.textContent = now.toLocaleDateString('pt-BR', { weekday: 'long' }).split('-')[0];
        dateElement.textContent = now.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });    }

    // Update the clock every second
    setInterval(updateClock, 1000);
    updateClock(); // Initial call to display time immediately
});
