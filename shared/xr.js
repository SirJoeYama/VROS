// Entering XR, shared by every page: picks passthrough (immersive-ar) when
// available, else VR; wires the Enter button; and re-enters XR without a tap
// when the browser hands a session over from the previous page (WebXR
// navigation: the "sessiongranted" event, supported by Quest Browser). That
// is what keeps you in the headset when moving between the home screen and
// apps.
export function setupEnterXR({ renderer, button, status, optionalFeatures = ['hand-tracking'], beforeEnter }) {
  let mode = null;

  const ready = (async () => {
    if (!navigator.xr) {
      button.textContent = 'XR not available';
      if (status) status.textContent = 'WebXR unavailable. Open this page in the Meta Quest Browser.';
      return null;
    }
    for (const m of ['immersive-ar', 'immersive-vr']) {
      if (await navigator.xr.isSessionSupported(m).catch(() => false)) {
        mode = m;
        break;
      }
    }
    if (!mode) {
      button.textContent = 'XR not available';
      if (status) status.textContent = 'No immersive session available. Desktop preview only.';
      return null;
    }
    button.disabled = false;
    button.textContent = mode === 'immersive-ar' ? 'Enter (passthrough)' : 'Enter VR';
    return mode;
  })();

  async function enter() {
    if (!mode || renderer.xr.isPresenting) return;
    beforeEnter?.();
    try {
      const session = await navigator.xr.requestSession(mode, { requiredFeatures: ['local-floor'], optionalFeatures });
      await renderer.xr.setSession(session);
    } catch (err) {
      if (status) status.textContent = 'Could not start XR: ' + err.message;
    }
  }

  button.addEventListener('click', enter);
  navigator.xr?.addEventListener('sessiongranted', async () => {
    await ready;
    enter();
  });

  return {
    ready,
    enter,
    get mode() {
      return mode;
    },
  };
}
