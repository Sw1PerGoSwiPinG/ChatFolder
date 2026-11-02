(() => {
  "use strict";
  // Adapters only discover answer containers; the engine owns UI and state.
  const adapters: ProviderAdapter[] = [];
  globalThis.ChatFold = {
    defaults: { enabled: true, defaultCollapsed: true },
    register(adapter) {
      if (!adapter.id || typeof adapter.matches !== "function" || typeof adapter.findAnswers !== "function") {
        throw new TypeError("Invalid ChatFolder adapter");
      }
      adapters.push(adapter);
    },
    resolve(location) { return adapters.find(adapter => adapter.matches(location)); }
  };
})();
