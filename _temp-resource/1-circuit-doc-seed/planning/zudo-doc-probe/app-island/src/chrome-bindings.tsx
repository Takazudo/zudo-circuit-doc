import { defineChromeBindings } from "@takazudo/zudo-doc/chrome-bindings";
import { circuitMdxExtras } from "@probe/circuit-ui/bindings";
export const chromeBindings = defineChromeBindings({ mdxExtras: { ...circuitMdxExtras } });
