import assert from "node:assert/strict";
import test from "node:test";

import { assessTossOpenApiContract } from "../scripts/check_toss_openapi_contract.mts";
import {
  TOSS_OPENAPI_BASE_URL,
  TOSS_OPENAPI_REQUIRED_OPERATIONS,
  TOSS_OPENAPI_SPEC_VERSION,
} from "../src/lib/toss/contract.ts";

type JsonObject = Record<string, unknown>;

const accountHeader = {
  name: "X-Tossinvest-Account",
  in: "header",
  required: true,
  schema: { type: "integer" },
};

const operation = (requiresAccountHeader: boolean, patch: JsonObject = {}) => ({
  parameters: requiresAccountHeader ? [accountHeader] : [],
  ...patch,
});

const completeContractSpec = () => {
  const paths: Record<string, JsonObject> = {};
  for (const required of TOSS_OPENAPI_REQUIRED_OPERATIONS) {
    paths[required.path] = {
      ...(paths[required.path] ?? {}),
      [required.method]: operation(required.accountHeader),
    };
  }
  paths["/api/v1/orders"] = {
    get: operation(true, {
      parameters: [
        accountHeader,
        { name: "status", in: "query", required: true, schema: { type: "string", enum: ["OPEN", "CLOSED"] } },
      ],
    }),
    post: operation(true, {
      requestBody: {
        content: {
          "application/json": {
            schema: {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    clientOrderId: { type: "string", maxLength: 36 },
                    quantity: { type: "string" },
                    price: { type: "string" },
                    confirmHighValueOrder: { type: "boolean" },
                  },
                },
                {
                  type: "object",
                  properties: {
                    clientOrderId: { type: "string", maxLength: 36 },
                    orderAmount: { type: "string" },
                    confirmHighValueOrder: { type: "boolean" },
                  },
                },
              ],
            },
          },
        },
      },
    }),
  };
  return {
    openapi: "3.1.0",
    info: { version: TOSS_OPENAPI_SPEC_VERSION },
    servers: [{ url: TOSS_OPENAPI_BASE_URL }],
    paths,
  } satisfies JsonObject;
};

test("toss openapi contract accepts required local client operations", () => {
  const report = assessTossOpenApiContract(completeContractSpec());

  assert.equal(report.ok, true);
  assert.equal(report.actualSpecVersion, TOSS_OPENAPI_SPEC_VERSION);
  assert.equal(report.requiredOperations.length, TOSS_OPENAPI_REQUIRED_OPERATIONS.length);
  assert.equal(report.requiredOperations.every((check) => check.ok), true);
});

test("toss openapi contract fails when account endpoints lose the account header", () => {
  const spec = completeContractSpec();
  const paths = spec.paths as Record<string, JsonObject>;
  paths["/api/v1/holdings"] = { get: operation(false) };

  const report = assessTossOpenApiContract(spec);

  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) =>
    issue.includes("GET /api/v1/holdings") && issue.includes("X-Tossinvest-Account"),
  ));
});

test("toss openapi contract fails on upstream spec version drift", () => {
  const spec = completeContractSpec();
  spec.info = { version: "9.9.9" };

  const report = assessTossOpenApiContract(spec);

  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) => issue.includes("version mismatch")));
});
