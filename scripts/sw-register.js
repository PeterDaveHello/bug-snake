// @ts-check

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then(() => console.log('SW registered'))
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.log('SW registration failed:', err);
      });
  });
}
