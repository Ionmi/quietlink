import { Electroview } from "electrobun/view";

const rpc = Electroview.defineRPC<any>({
  maxRequestTime: 30_000,
  handlers: {
    requests: {},
    messages: {
      "view-changed": (view: unknown) => window.dispatchEvent(new CustomEvent("quietlink:view", { detail: view })),
    },
  },
});
const view = new Electroview({ rpc });
const request = (view.rpc as any).request;

declare global {
  interface Window {
    quietlink: { call<T = unknown>(method: string, ...args: unknown[]): Promise<T> };
  }
}

window.quietlink = {
  call: (method, ...args) => request.invoke({ method, args }),
};
