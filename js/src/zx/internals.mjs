// Override hub for the bundled helper libraries (issue #26).
//
// Each helper (chalk, which, fs, YAML, ...) is exported through `bus.wrap`,
// which returns a proxy that always forwards to the implementation currently
// registered under its name. Before the public entry point locks the bus,
// embedders may swap an implementation with `bus.override(name, impl)`.

let locked = false;
const store = new Map();

const override = (name, api) => store.set(name, api);

function wrap(name, api) {
  if (locked) {
    throw new Error('bus is locked');
  }
  override(name, api);
  return new Proxy(api, {
    get(_target, key) {
      const current = store.get(name);
      return current[key] ?? current?.default?.[key];
    },
    set(_target, key, value) {
      store.get(name)[key] = value;
      return true;
    },
    apply(_target, self, args) {
      return store.get(name).apply(self, args);
    },
  });
}

export const bus = {
  override,
  wrap,
  lock: () => {
    locked = true;
  },
};
