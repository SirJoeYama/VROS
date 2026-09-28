// The start screen. Each app lives in its own folder under apps/ with an
// index.html and an icon.svg; add an entry here to put it on the home screen.
const APPS = [
  { id: 'galaxies', name: 'Galaxies', blurb: 'particle formations you shape with your hands' },
];

const grid = document.getElementById('grid');
for (const app of APPS) {
  const a = document.createElement('a');
  a.className = 'app';
  a.href = `apps/${app.id}/`;
  a.innerHTML = `<img src="apps/${app.id}/icon.svg" alt="" /><span class="name"></span><span class="blurb"></span>`;
  a.querySelector('.name').textContent = app.name;
  a.querySelector('.blurb').textContent = app.blurb;
  grid.appendChild(a);
}

const clock = document.getElementById('clock');
function tick() {
  clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
tick();
setInterval(tick, 10000);
