// One shared IntersectionObserver for every page card (cheaper than one per card).
type Callback = (visible: boolean) => void;

const callbacks = new WeakMap<Element, Callback>();
let observer: IntersectionObserver | null = null;

function shared(): IntersectionObserver {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) callbacks.get(e.target)?.(e.isIntersecting);
    },
    { rootMargin: '300px 0px' }, // start rendering just before a card scrolls into view
  );
  return observer;
}

/** Calls `cb(true/false)` as `node` enters or leaves the (slightly enlarged) viewport. */
export function observeVisible(node: Element, cb: Callback): () => void {
  callbacks.set(node, cb);
  shared().observe(node);
  return () => {
    observer?.unobserve(node);
    callbacks.delete(node);
  };
}
