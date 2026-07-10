import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  TOSS_OPENAPI_BASE_URL,
  TOSS_OPENAPI_CONTRACT,
  TOSS_OPENAPI_JSON_URL,
  TOSS_OPENAPI_REQUIRED_OPERATIONS,
  TOSS_OPENAPI_SPEC_VERSION,
  type TossOpenApiRequiredOperation,
} from "../src/lib/toss/contract.ts";

type JsonObject = Record<string, unknown>;

export type TossOpenApiOperationCheck = TossOpenApiRequiredOperation & {
  ok: boolean;
  issues: string[];
};

export type TossOpenApiContractReport = {
  ok: boolean;
  source: string;
  checkedAt: string;
  expectedSpecVersion: string;
  actualSpecVersion: string | null;
  baseUrl: string;
  requiredOperations: TossOpenApiOperationCheck[];
  issues: string[];
  warnings: string[];
};

const isObject = (value: unknown): value is JsonObject =>
  !!value && typeof value === "object" && !Array.isArray(value);

const refValue = (root: JsonObject, ref: string): unknown => {
  if (!ref.startsWith("#/")) {
    return null;
  }
  return ref
    .slice(2)
    .split("/")
    .reduce<unknown>((current, part) => isObject(current) ? current[part] : undefined, root);
};

const dereference = (root: JsonObject, value: unknown): JsonObject | null => {
  if (!isObject(value)) {
    return null;
  }
  const ref = typeof value.$ref === "string" ? value.$ref : null;
  if (!ref) {
    return value;
  }
  const resolved = refValue(root, ref);
  return isObject(resolved) ? resolved : null;
};

const pathItem = (spec: JsonObject, path: string) => {
  const paths = isObject(spec.paths) ? spec.paths : {};
  return isObject(paths[path]) ? paths[path] as JsonObject : null;
};

const operationObject = (spec: JsonObject, operation: TossOpenApiRequiredOperation) => {
  const item = pathItem(spec, operation.path);
  const method = item?.[operation.method];
  return isObject(method) ? method : null;
};

const operationParameters = (spec: JsonObject, operation: JsonObject) => {
  const parameters = Array.isArray(operation.parameters) ? operation.parameters : [];
  return parameters
    .map((parameter) => dereference(spec, parameter))
    .filter((parameter): parameter is JsonObject => !!parameter);
};

const schemaFromRequestBody = (spec: JsonObject, operation: JsonObject) => {
  const requestBody = dereference(spec, operation.requestBody);
  const content = isObject(requestBody?.content) ? requestBody.content : {};
  const jsonContent = isObject(content["application/json"]) ? content["application/json"] as JsonObject : null;
  return dereference(spec, jsonContent?.schema);
};

const enumValues = (schema: unknown) => {
  const resolvedSchema = isObject(schema) ? schema : {};
  return Array.isArray(resolvedSchema.enum)
    ? resolvedSchema.enum.filter((item): item is string => typeof item === "string")
    : [];
};

const accountHeaderPresent = (spec: JsonObject, operation: JsonObject) =>
  operationParameters(spec, operation).some((parameter) =>
    parameter.name === TOSS_OPENAPI_CONTRACT.accountHeaderName &&
      parameter.in === "header" &&
      parameter.required === true,
  );

const checkOrderListStatusFilter = (spec: JsonObject, operation: JsonObject) => {
  const statusParam = operationParameters(spec, operation).find((parameter) =>
    parameter.name === "status" && parameter.in === "query",
  );
  const values = enumValues(statusParam?.schema);
  return values.includes("OPEN") && values.includes("CLOSED");
};

const checkOrderCreateSchema = (spec: JsonObject, operation: JsonObject) => {
  const schema = schemaFromRequestBody(spec, operation);
  const variants = Array.isArray(schema?.oneOf)
    ? schema.oneOf.map((item) => dereference(spec, item)).filter((item): item is JsonObject => !!item)
    : [];
  const hasQuantityBased = variants.some((variant) => {
    const properties = isObject(variant.properties) ? variant.properties : {};
    return isObject(properties.quantity) && isObject(properties.price);
  });
  const hasAmountBased = variants.some((variant) => {
    const properties = isObject(variant.properties) ? variant.properties : {};
    return isObject(properties.orderAmount);
  });
  const clientOrderIdLimited = variants.length > 0 && variants.every((variant) => {
    const properties = isObject(variant.properties) ? variant.properties : {};
    const clientOrderId = isObject(properties.clientOrderId) ? properties.clientOrderId : {};
    return clientOrderId.maxLength === 36;
  });
  const highValueFlagPresent = variants.length > 0 && variants.every((variant) => {
    const properties = isObject(variant.properties) ? variant.properties : {};
    return isObject(properties.confirmHighValueOrder);
  });
  return hasQuantityBased && hasAmountBased && clientOrderIdLimited && highValueFlagPresent;
};

const checkOperation = (
  spec: JsonObject,
  requiredOperation: TossOpenApiRequiredOperation,
): TossOpenApiOperationCheck => {
  const issues: string[] = [];
  const operation = operationObject(spec, requiredOperation);
  if (!pathItem(spec, requiredOperation.path)) {
    issues.push(`missing path ${requiredOperation.path}`);
  } else if (!operation) {
    issues.push(`missing method ${requiredOperation.method.toUpperCase()} ${requiredOperation.path}`);
  }
  if (operation && requiredOperation.accountHeader && !accountHeaderPresent(spec, operation)) {
    issues.push(`missing required ${TOSS_OPENAPI_CONTRACT.accountHeaderName} header`);
  }
  if (operation && requiredOperation.path === "/api/v1/orders" && requiredOperation.method === "get" && !checkOrderListStatusFilter(spec, operation)) {
    issues.push("order list status query must include OPEN and CLOSED");
  }
  if (operation && requiredOperation.path === "/api/v1/orders" && requiredOperation.method === "post" && !checkOrderCreateSchema(spec, operation)) {
    issues.push("order create schema must include quantity/amount variants, clientOrderId maxLength 36, and confirmHighValueOrder");
  }
  return {
    ...requiredOperation,
    ok: issues.length === 0,
    issues,
  };
};

export const assessTossOpenApiContract = (
  spec: JsonObject,
  source = "inline",
): TossOpenApiContractReport => {
  const issues: string[] = [];
  const warnings: string[] = [];
  const actualSpecVersion = isObject(spec.info) && typeof spec.info.version === "string"
    ? spec.info.version
    : null;
  if (actualSpecVersion !== TOSS_OPENAPI_SPEC_VERSION) {
    issues.push(`OpenAPI version mismatch: expected ${TOSS_OPENAPI_SPEC_VERSION}, got ${actualSpecVersion ?? "unknown"}`);
  }
  const servers = Array.isArray(spec.servers)
    ? spec.servers.filter(isObject).map((server) => server.url).filter((url): url is string => typeof url === "string")
    : [];
  if (!servers.includes(TOSS_OPENAPI_BASE_URL)) {
    issues.push(`OpenAPI servers do not include ${TOSS_OPENAPI_BASE_URL}`);
  }
  if (spec.openapi !== "3.1.0") {
    warnings.push(`OpenAPI document version is ${typeof spec.openapi === "string" ? spec.openapi : "unknown"}, expected 3.1.0`);
  }

  const requiredOperations = TOSS_OPENAPI_REQUIRED_OPERATIONS.map((operation) =>
    checkOperation(spec, operation),
  );
  issues.push(...requiredOperations.flatMap((operation) =>
    operation.issues.map((issue) => `${operation.method.toUpperCase()} ${operation.path}: ${issue}`),
  ));

  return {
    ok: issues.length === 0,
    source,
    checkedAt: new Date().toISOString(),
    expectedSpecVersion: TOSS_OPENAPI_SPEC_VERSION,
    actualSpecVersion,
    baseUrl: TOSS_OPENAPI_BASE_URL,
    requiredOperations,
    issues,
    warnings,
  };
};

const argValue = (name: string) => {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
};

const readSpec = async () => {
  const fileArg = argValue("file") ?? process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (fileArg) {
    const path = resolve(fileArg);
    return {
      source: path,
      spec: JSON.parse(await readFile(path, "utf8")) as JsonObject,
    };
  }
  const response = await fetch(TOSS_OPENAPI_JSON_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch Toss OpenAPI JSON: HTTP ${response.status}`);
  }
  return {
    source: TOSS_OPENAPI_JSON_URL,
    spec: await response.json() as JsonObject,
  };
};

const main = async () => {
  const { source, spec } = await readSpec();
  const report = assessTossOpenApiContract(spec, source);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    process.exitCode = 1;
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
