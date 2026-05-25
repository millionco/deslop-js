import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectEffectCleanupIssues } from "../src/index.js";

const collectEffectCleanupResourceNames = (sourceText: string): string[] =>
  detectEffectCleanupIssues(sourceText).map((issue) => issue.resourceName);

describe("effect cleanup detector", () => {
  it("does not flag React Native AppState subscriptions cleaned up with remove()", () => {
    const resourceNames = collectEffectCleanupResourceNames(`
import { useEffect } from "react";
import { AppState } from "react-native";

declare const focusManager: { setFocused: (focused: boolean) => void };

export const AppStateFocus = () => {
  useEffect(() => {
    const sub = AppState.addEventListener("change", status => {
      focusManager.setFocused(status === "active");
    });
    return () => {
      sub.remove();
    };
  }, []);
};
`);

    assert.deepEqual(resourceNames, []);
  });

  it("accepts generic release methods on subscribe-like return bindings", () => {
    for (const releaseMethodName of ["remove", "cleanup", "dispose", "destroy", "teardown"]) {
      const resourceNames = collectEffectCleanupResourceNames(`
import { useEffect } from "react";

declare const source: { addListener: (handler: () => void) => { ${releaseMethodName}: () => void } };
declare const handler: () => void;

export const Subscribed = () => {
  useEffect(() => {
    const subscription = source.addListener(handler);
    return () => {
      subscription.${releaseMethodName}();
    };
  }, []);
};
`);

      assert.deepEqual(resourceNames, [], `${releaseMethodName} should release bound subscription`);
    }
  });

  it("does not trust generic release methods on unrelated receivers", () => {
    for (const releaseMethodName of ["remove", "cleanup", "dispose", "destroy", "teardown"]) {
      const resourceNames = collectEffectCleanupResourceNames(`
import { useEffect } from "react";

declare const window: { addEventListener: (name: string, handler: () => void) => void };
declare const onResize: () => void;
declare const node: { ${releaseMethodName}: () => void };

export const Resize = () => {
  useEffect(() => {
    window.addEventListener("resize", onResize);
    return () => {
      node.${releaseMethodName}();
    };
  }, []);
};
`);

      assert.deepEqual(
        resourceNames,
        ["addEventListener"],
        `${releaseMethodName} on an unrelated receiver should not satisfy cleanup`,
      );
    }
  });
});
