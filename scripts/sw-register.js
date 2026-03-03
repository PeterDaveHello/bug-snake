// @ts-check

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        const logState = () => {
          if (reg.active) {
            // eslint-disable-next-line no-console
            console.log('SW registration succeeded: active');
            return;
          }

          if (reg.waiting) {
            // eslint-disable-next-line no-console
            console.log('SW registration state: waiting');
            return;
          }

          if (reg.installing) {
            // eslint-disable-next-line no-console
            console.log('SW registration state: installing');
            return;
          }

          // eslint-disable-next-line no-console
          console.log('SW registration succeeded');
        };

        logState();

        const pendingWorker = reg.waiting || reg.installing;
        if (pendingWorker) {
          pendingWorker.addEventListener('statechange', () => {
            logState();
          });
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.log('SW registration failed:', err);
      });
  });
}
