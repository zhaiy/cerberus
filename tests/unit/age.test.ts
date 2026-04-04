import { describe, expect, it } from "vitest";

import { extractPublicKey } from "../../src/crypto/age.js";
import { CerberusError, ErrorCode } from "../../src/core/errors.js";

describe("extractPublicKey", () => {
  it("reads the public key from a standard age identity comment line", () => {
    const identity = Buffer.from(
      [
        "# created: ...",
        "# public key: age1ql3z7hjyjg65e44w4n6dpx3s7v03cwux6e7cfmzrytux6fgpu0ss6c4kpe",
        "AGE-SECRET-KEY-1...",
      ].join("\n"),
      "utf8",
    );
    expect(extractPublicKey(identity)).toBe(
      "age1ql3z7hjyjg65e44w4n6dpx3s7v03cwux6e7cfmzrytux6fgpu0ss6c4kpe",
    );
  });

  it("throws when no public key line is present", () => {
    const identity = Buffer.from("not an age identity file\n", "utf8");
    expect(() => extractPublicKey(identity)).toThrow(CerberusError);
    expect(() => extractPublicKey(identity)).toThrowError(
      expect.objectContaining({ code: ErrorCode.UNKNOWN }),
    );
  });
});
