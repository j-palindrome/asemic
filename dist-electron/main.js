import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { readFile } from "fs/promises";
import { Server as Server$1, Client } from "node-osc";
import { extname } from "path";
import sharp from "sharp";
import { Server } from "socket.io";
import sc from "supercolliderjs";
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
const ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
const getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};
const ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
class ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
        fieldErrors[sub.path[0]].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
}
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};
const errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
let overrideErrorMap = errorMap;
function getErrorMap() {
  return overrideErrorMap;
}
const makeIssue = (params) => {
  const { data, path: path2, errorMaps, issueData } = params;
  const fullPath = [...path2, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === errorMap ? void 0 : errorMap
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
class ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
}
const INVALID = Object.freeze({
  status: "aborted"
});
const DIRTY = (value) => ({ status: "dirty", value });
const OK = (value) => ({ status: "valid", value });
const isAborted = (x) => x.status === "aborted";
const isDirty = (x) => x.status === "dirty";
const isValid = (x) => x.status === "valid";
const isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message == null ? void 0 : message.message;
})(errorUtil || (errorUtil = {}));
class ParseInputLazyPath {
  constructor(parent, value, path2, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path2;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
}
const handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
class ZodType {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: (params == null ? void 0 : params.async) ?? false,
        contextualErrorMap: params == null ? void 0 : params.errorMap
      },
      path: (params == null ? void 0 : params.path) || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    var _a, _b;
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if ((_b = (_a = err == null ? void 0 : err.message) == null ? void 0 : _a.toLowerCase()) == null ? void 0 : _b.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params == null ? void 0 : params.errorMap,
        async: true
      },
      path: (params == null ? void 0 : params.path) || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
}
const cuidRegex = /^c[^\s-]{8,}$/i;
const cuid2Regex = /^[0-9a-z]+$/;
const ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
const nanoidRegex = /^[a-z0-9_-]{21}$/i;
const jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
const durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
const emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
const _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
let emojiRegex;
const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
const ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
const ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
const base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
const base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
const dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
const dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && (decoded == null ? void 0 : decoded.typ) !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
class ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof (options == null ? void 0 : options.precision) === "undefined" ? null : options == null ? void 0 : options.precision,
      offset: (options == null ? void 0 : options.offset) ?? false,
      local: (options == null ? void 0 : options.local) ?? false,
      ...errorUtil.errToObj(options == null ? void 0 : options.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof (options == null ? void 0 : options.precision) === "undefined" ? null : options == null ? void 0 : options.precision,
      ...errorUtil.errToObj(options == null ? void 0 : options.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options == null ? void 0 : options.position,
      ...errorUtil.errToObj(options == null ? void 0 : options.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
}
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: (params == null ? void 0 : params.coerce) ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
class ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
}
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: (params == null ? void 0 : params.coerce) || false,
    ...processCreateParams(params)
  });
};
class ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
}
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: (params == null ? void 0 : params.coerce) ?? false,
    ...processCreateParams(params)
  });
};
class ZodBoolean extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: (params == null ? void 0 : params.coerce) || false,
    ...processCreateParams(params)
  });
};
class ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
}
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: (params == null ? void 0 : params.coerce) || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
class ZodSymbol extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
class ZodUndefined extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
class ZodNull extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
class ZodAny extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
}
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
class ZodUnknown extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
}
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
class ZodNever extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
}
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
class ZodVoid extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
class ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
}
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
class ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") ;
      else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          var _a, _b;
          const defaultError = ((_b = (_a = this._def).errorMap) == null ? void 0 : _b.call(_a, issue, ctx).message) ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
}
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
class ZodUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
}
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
class ZodIntersection extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
}
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
class ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new ZodTuple({
      ...this._def,
      rest
    });
  }
}
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
class ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
}
class ZodMap extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
}
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
class ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
}
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
class ZodLazy extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
}
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
class ZodLiteral extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
}
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
class ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
}
ZodEnum.create = createZodEnum;
class ZodNativeEnum extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
}
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
class ZodPromise extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
}
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
class ZodEffects extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
}
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
class ZodOptional extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
class ZodNullable extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
class ZodDefault extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
}
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
class ZodCatch extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
}
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
class ZodNaN extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
}
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
class ZodBranded extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
}
class ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
}
class ZodReadonly extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
const stringType = ZodString.create;
const numberType = ZodNumber.create;
ZodNever.create;
ZodArray.create;
const objectType = ZodObject.create;
ZodUnion.create;
ZodIntersection.create;
ZodTuple.create;
const recordType = ZodRecord.create;
const literalType = ZodLiteral.create;
ZodEnum.create;
ZodPromise.create;
ZodOptional.create;
ZodNullable.create;
const paramSchema = objectType({
  type: literalType("number"),
  value: numberType(),
  max: numberType(),
  min: numberType(),
  exponent: numberType().optional().default(1)
});
const inputSchema = objectType({
  params: recordType(stringType(), paramSchema),
  presets: recordType(stringType(), recordType(stringType(), paramSchema))
});
let schemaState = {
  params: {},
  presets: {}
};
async function startDevServer() {
  const io = new Server(3e3, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });
  let scServer = null;
  sc.server.boot().then(
    async (thisServer) => {
      scServer = thisServer;
      console.log("✅ SuperCollider server started successfully");
    },
    (err) => {
      console.warn("⚠️ SuperCollider server failed to start:", err.message);
      console.log("🔄 Continuing without SuperCollider server...");
      scServer = null;
    }
  );
  const synths = {};
  const synthDefs = {};
  io.on("connection", (socket) => {
    socket.emit("params", schemaState);
    socket.on("params:reset", () => {
      schemaState.params = {};
    });
    socket.on("params", (obj) => {
      try {
        schemaState = { ...schemaState, ...inputSchema.parse(obj) };
        io.emit("params", schemaState);
      } catch (error) {
        console.error("Invalid params received:", error);
      }
    });
    socket.on("sc:synth", async (name, synthDef) => {
      if (!scServer) return;
      try {
        const def = await scServer.synthDef(name, synthDef);
        synthDefs[name] = def;
      } catch (err) {
        console.error("Error compiling SynthDef:", err);
        return;
      }
    });
    socket.on("sc:set", async (name, param, value) => {
      try {
        if (!synths[name]) return false;
        synths[name].set({ [param]: value });
      } catch (err) {
        console.error("Error setting Synth parameter:", err);
      }
    });
    socket.on("sc:on", async () => {
      for (let synth in synthDefs) {
        synths[synth] = await scServer.synth(synthDefs[synth]);
      }
    });
    socket.on("sc:off", () => {
      for (const key in synths) {
        synths[key].free();
        delete synths[key];
      }
    });
    socket.on("files:load", async (files) => {
      try {
        const filesBitmaps = {};
        for (const [name, filePath] of Object.entries(files)) {
          try {
            const fileData = await readFile(filePath);
            const ext = extname(filePath).toLowerCase();
            if ([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"].includes(ext)) {
              const imageBuffer = await sharp(fileData).raw().toBuffer({ resolveWithObject: true });
              const imageData = {
                data: new Uint8ClampedArray(imageBuffer.data),
                width: imageBuffer.info.width,
                height: imageBuffer.info.height
              };
              filesBitmaps[name] = [imageData];
            } else if ([".mp4", ".webm", ".mov", ".avi"].includes(ext)) {
              console.log(
                `Video file ${filePath} detected - video processing not implemented`
              );
            }
          } catch (error) {
            console.error(`Error loading file ${filePath}:`, error);
          }
        }
        socket.emit("files:loaded", filesBitmaps);
      } catch (error) {
        console.error("Error loading files:", error);
      }
    });
    socket.on("disconnect", () => {
      console.log("Socket.IO client disconnected:", socket.id);
    });
  });
  const oscConfig = { port: 57121, host: "127.0.0.1" };
  const oscServer = new Server$1(oscConfig.port, oscConfig.host);
  new Client(oscConfig.host, oscConfig.port);
  oscServer.on("listening", () => {
    console.log(
      `🎵 OSC Server listening on ${oscConfig.host}:${oscConfig.port}`
    );
  });
  oscServer.on("message", (msg) => {
    console.log("📨 OSC Message received:", msg);
  });
  oscServer.on("error", (error) => {
    console.error("❌ OSC Server error:", error);
  });
  oscServer.on("message", (msg) => {
    const [address, ...args] = msg;
    switch (address) {
      case "/asemic/param":
        console.log("⚙️ Parameter update:", args);
        io.emit("asemic:param", args);
        break;
      default:
        io.emit("osc:message", { address, data: args });
    }
  });
}
const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: process.env.VITE_PUBLIC ? path.join(process.env.VITE_PUBLIC, "vite.svg") : void 0,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
  startDevServer();
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
app.whenReady().then(createWindow);
ipcMain.handle("read-file", async (_, filePath) => {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return { success: true, content };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle("write-file", async (_, filePath, content) => {
  try {
    await fs.writeFile(filePath, content, "utf-8");
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle("show-open-dialog", async () => {
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile"]
  });
  return result;
});
ipcMain.handle("show-save-dialog", async () => {
  const result = await dialog.showSaveDialog(win, {
    filters: [
      { name: "Asemic Files", extensions: ["asemic"] },
      { name: "All Files", extensions: ["*"] }
    ]
  });
  return result;
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZXMiOlsiLi4vbm9kZV9tb2R1bGVzLy5wbnBtL3pvZEAzLjI1LjY3L25vZGVfbW9kdWxlcy96b2QvZGlzdC9lc20vdjMvaGVscGVycy91dGlsLmpzIiwiLi4vbm9kZV9tb2R1bGVzLy5wbnBtL3pvZEAzLjI1LjY3L25vZGVfbW9kdWxlcy96b2QvZGlzdC9lc20vdjMvWm9kRXJyb3IuanMiLCIuLi9ub2RlX21vZHVsZXMvLnBucG0vem9kQDMuMjUuNjcvbm9kZV9tb2R1bGVzL3pvZC9kaXN0L2VzbS92My9sb2NhbGVzL2VuLmpzIiwiLi4vbm9kZV9tb2R1bGVzLy5wbnBtL3pvZEAzLjI1LjY3L25vZGVfbW9kdWxlcy96b2QvZGlzdC9lc20vdjMvZXJyb3JzLmpzIiwiLi4vbm9kZV9tb2R1bGVzLy5wbnBtL3pvZEAzLjI1LjY3L25vZGVfbW9kdWxlcy96b2QvZGlzdC9lc20vdjMvaGVscGVycy9wYXJzZVV0aWwuanMiLCIuLi9ub2RlX21vZHVsZXMvLnBucG0vem9kQDMuMjUuNjcvbm9kZV9tb2R1bGVzL3pvZC9kaXN0L2VzbS92My9oZWxwZXJzL2Vycm9yVXRpbC5qcyIsIi4uL25vZGVfbW9kdWxlcy8ucG5wbS96b2RAMy4yNS42Ny9ub2RlX21vZHVsZXMvem9kL2Rpc3QvZXNtL3YzL3R5cGVzLmpzIiwiLi4vc3JjL3NlcnZlci9pbnB1dFNjaGVtYS50cyIsIi4uL3NyYy9zZXJ2ZXIvc2VydmVyLnRzIiwiLi4vZWxlY3Ryb24vbWFpbi50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgdmFyIHV0aWw7XG4oZnVuY3Rpb24gKHV0aWwpIHtcbiAgICB1dGlsLmFzc2VydEVxdWFsID0gKF8pID0+IHsgfTtcbiAgICBmdW5jdGlvbiBhc3NlcnRJcyhfYXJnKSB7IH1cbiAgICB1dGlsLmFzc2VydElzID0gYXNzZXJ0SXM7XG4gICAgZnVuY3Rpb24gYXNzZXJ0TmV2ZXIoX3gpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCk7XG4gICAgfVxuICAgIHV0aWwuYXNzZXJ0TmV2ZXIgPSBhc3NlcnROZXZlcjtcbiAgICB1dGlsLmFycmF5VG9FbnVtID0gKGl0ZW1zKSA9PiB7XG4gICAgICAgIGNvbnN0IG9iaiA9IHt9O1xuICAgICAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMpIHtcbiAgICAgICAgICAgIG9ialtpdGVtXSA9IGl0ZW07XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG9iajtcbiAgICB9O1xuICAgIHV0aWwuZ2V0VmFsaWRFbnVtVmFsdWVzID0gKG9iaikgPT4ge1xuICAgICAgICBjb25zdCB2YWxpZEtleXMgPSB1dGlsLm9iamVjdEtleXMob2JqKS5maWx0ZXIoKGspID0+IHR5cGVvZiBvYmpbb2JqW2tdXSAhPT0gXCJudW1iZXJcIik7XG4gICAgICAgIGNvbnN0IGZpbHRlcmVkID0ge307XG4gICAgICAgIGZvciAoY29uc3QgayBvZiB2YWxpZEtleXMpIHtcbiAgICAgICAgICAgIGZpbHRlcmVkW2tdID0gb2JqW2tdO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB1dGlsLm9iamVjdFZhbHVlcyhmaWx0ZXJlZCk7XG4gICAgfTtcbiAgICB1dGlsLm9iamVjdFZhbHVlcyA9IChvYmopID0+IHtcbiAgICAgICAgcmV0dXJuIHV0aWwub2JqZWN0S2V5cyhvYmopLm1hcChmdW5jdGlvbiAoZSkge1xuICAgICAgICAgICAgcmV0dXJuIG9ialtlXTtcbiAgICAgICAgfSk7XG4gICAgfTtcbiAgICB1dGlsLm9iamVjdEtleXMgPSB0eXBlb2YgT2JqZWN0LmtleXMgPT09IFwiZnVuY3Rpb25cIiAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIGJhbi9iYW5cbiAgICAgICAgPyAob2JqKSA9PiBPYmplY3Qua2V5cyhvYmopIC8vIGVzbGludC1kaXNhYmxlLWxpbmUgYmFuL2JhblxuICAgICAgICA6IChvYmplY3QpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGtleXMgPSBbXTtcbiAgICAgICAgICAgIGZvciAoY29uc3Qga2V5IGluIG9iamVjdCkge1xuICAgICAgICAgICAgICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwob2JqZWN0LCBrZXkpKSB7XG4gICAgICAgICAgICAgICAgICAgIGtleXMucHVzaChrZXkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBrZXlzO1xuICAgICAgICB9O1xuICAgIHV0aWwuZmluZCA9IChhcnIsIGNoZWNrZXIpID0+IHtcbiAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIGFycikge1xuICAgICAgICAgICAgaWYgKGNoZWNrZXIoaXRlbSkpXG4gICAgICAgICAgICAgICAgcmV0dXJuIGl0ZW07XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9O1xuICAgIHV0aWwuaXNJbnRlZ2VyID0gdHlwZW9mIE51bWJlci5pc0ludGVnZXIgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgICA/ICh2YWwpID0+IE51bWJlci5pc0ludGVnZXIodmFsKSAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIGJhbi9iYW5cbiAgICAgICAgOiAodmFsKSA9PiB0eXBlb2YgdmFsID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZSh2YWwpICYmIE1hdGguZmxvb3IodmFsKSA9PT0gdmFsO1xuICAgIGZ1bmN0aW9uIGpvaW5WYWx1ZXMoYXJyYXksIHNlcGFyYXRvciA9IFwiIHwgXCIpIHtcbiAgICAgICAgcmV0dXJuIGFycmF5Lm1hcCgodmFsKSA9PiAodHlwZW9mIHZhbCA9PT0gXCJzdHJpbmdcIiA/IGAnJHt2YWx9J2AgOiB2YWwpKS5qb2luKHNlcGFyYXRvcik7XG4gICAgfVxuICAgIHV0aWwuam9pblZhbHVlcyA9IGpvaW5WYWx1ZXM7XG4gICAgdXRpbC5qc29uU3RyaW5naWZ5UmVwbGFjZXIgPSAoXywgdmFsdWUpID0+IHtcbiAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJiaWdpbnRcIikge1xuICAgICAgICAgICAgcmV0dXJuIHZhbHVlLnRvU3RyaW5nKCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH07XG59KSh1dGlsIHx8ICh1dGlsID0ge30pKTtcbmV4cG9ydCB2YXIgb2JqZWN0VXRpbDtcbihmdW5jdGlvbiAob2JqZWN0VXRpbCkge1xuICAgIG9iamVjdFV0aWwubWVyZ2VTaGFwZXMgPSAoZmlyc3QsIHNlY29uZCkgPT4ge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgLi4uZmlyc3QsXG4gICAgICAgICAgICAuLi5zZWNvbmQsIC8vIHNlY29uZCBvdmVyd3JpdGVzIGZpcnN0XG4gICAgICAgIH07XG4gICAgfTtcbn0pKG9iamVjdFV0aWwgfHwgKG9iamVjdFV0aWwgPSB7fSkpO1xuZXhwb3J0IGNvbnN0IFpvZFBhcnNlZFR5cGUgPSB1dGlsLmFycmF5VG9FbnVtKFtcbiAgICBcInN0cmluZ1wiLFxuICAgIFwibmFuXCIsXG4gICAgXCJudW1iZXJcIixcbiAgICBcImludGVnZXJcIixcbiAgICBcImZsb2F0XCIsXG4gICAgXCJib29sZWFuXCIsXG4gICAgXCJkYXRlXCIsXG4gICAgXCJiaWdpbnRcIixcbiAgICBcInN5bWJvbFwiLFxuICAgIFwiZnVuY3Rpb25cIixcbiAgICBcInVuZGVmaW5lZFwiLFxuICAgIFwibnVsbFwiLFxuICAgIFwiYXJyYXlcIixcbiAgICBcIm9iamVjdFwiLFxuICAgIFwidW5rbm93blwiLFxuICAgIFwicHJvbWlzZVwiLFxuICAgIFwidm9pZFwiLFxuICAgIFwibmV2ZXJcIixcbiAgICBcIm1hcFwiLFxuICAgIFwic2V0XCIsXG5dKTtcbmV4cG9ydCBjb25zdCBnZXRQYXJzZWRUeXBlID0gKGRhdGEpID0+IHtcbiAgICBjb25zdCB0ID0gdHlwZW9mIGRhdGE7XG4gICAgc3dpdGNoICh0KSB7XG4gICAgICAgIGNhc2UgXCJ1bmRlZmluZWRcIjpcbiAgICAgICAgICAgIHJldHVybiBab2RQYXJzZWRUeXBlLnVuZGVmaW5lZDtcbiAgICAgICAgY2FzZSBcInN0cmluZ1wiOlxuICAgICAgICAgICAgcmV0dXJuIFpvZFBhcnNlZFR5cGUuc3RyaW5nO1xuICAgICAgICBjYXNlIFwibnVtYmVyXCI6XG4gICAgICAgICAgICByZXR1cm4gTnVtYmVyLmlzTmFOKGRhdGEpID8gWm9kUGFyc2VkVHlwZS5uYW4gOiBab2RQYXJzZWRUeXBlLm51bWJlcjtcbiAgICAgICAgY2FzZSBcImJvb2xlYW5cIjpcbiAgICAgICAgICAgIHJldHVybiBab2RQYXJzZWRUeXBlLmJvb2xlYW47XG4gICAgICAgIGNhc2UgXCJmdW5jdGlvblwiOlxuICAgICAgICAgICAgcmV0dXJuIFpvZFBhcnNlZFR5cGUuZnVuY3Rpb247XG4gICAgICAgIGNhc2UgXCJiaWdpbnRcIjpcbiAgICAgICAgICAgIHJldHVybiBab2RQYXJzZWRUeXBlLmJpZ2ludDtcbiAgICAgICAgY2FzZSBcInN5bWJvbFwiOlxuICAgICAgICAgICAgcmV0dXJuIFpvZFBhcnNlZFR5cGUuc3ltYm9sO1xuICAgICAgICBjYXNlIFwib2JqZWN0XCI6XG4gICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShkYXRhKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBab2RQYXJzZWRUeXBlLmFycmF5O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGRhdGEgPT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gWm9kUGFyc2VkVHlwZS5udWxsO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGRhdGEudGhlbiAmJiB0eXBlb2YgZGF0YS50aGVuID09PSBcImZ1bmN0aW9uXCIgJiYgZGF0YS5jYXRjaCAmJiB0eXBlb2YgZGF0YS5jYXRjaCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFpvZFBhcnNlZFR5cGUucHJvbWlzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICh0eXBlb2YgTWFwICE9PSBcInVuZGVmaW5lZFwiICYmIGRhdGEgaW5zdGFuY2VvZiBNYXApIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gWm9kUGFyc2VkVHlwZS5tYXA7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodHlwZW9mIFNldCAhPT0gXCJ1bmRlZmluZWRcIiAmJiBkYXRhIGluc3RhbmNlb2YgU2V0KSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFpvZFBhcnNlZFR5cGUuc2V0O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHR5cGVvZiBEYXRlICE9PSBcInVuZGVmaW5lZFwiICYmIGRhdGEgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFpvZFBhcnNlZFR5cGUuZGF0ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBab2RQYXJzZWRUeXBlLm9iamVjdDtcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHJldHVybiBab2RQYXJzZWRUeXBlLnVua25vd247XG4gICAgfVxufTtcbiIsImltcG9ydCB7IHV0aWwgfSBmcm9tIFwiLi9oZWxwZXJzL3V0aWwuanNcIjtcbmV4cG9ydCBjb25zdCBab2RJc3N1ZUNvZGUgPSB1dGlsLmFycmF5VG9FbnVtKFtcbiAgICBcImludmFsaWRfdHlwZVwiLFxuICAgIFwiaW52YWxpZF9saXRlcmFsXCIsXG4gICAgXCJjdXN0b21cIixcbiAgICBcImludmFsaWRfdW5pb25cIixcbiAgICBcImludmFsaWRfdW5pb25fZGlzY3JpbWluYXRvclwiLFxuICAgIFwiaW52YWxpZF9lbnVtX3ZhbHVlXCIsXG4gICAgXCJ1bnJlY29nbml6ZWRfa2V5c1wiLFxuICAgIFwiaW52YWxpZF9hcmd1bWVudHNcIixcbiAgICBcImludmFsaWRfcmV0dXJuX3R5cGVcIixcbiAgICBcImludmFsaWRfZGF0ZVwiLFxuICAgIFwiaW52YWxpZF9zdHJpbmdcIixcbiAgICBcInRvb19zbWFsbFwiLFxuICAgIFwidG9vX2JpZ1wiLFxuICAgIFwiaW52YWxpZF9pbnRlcnNlY3Rpb25fdHlwZXNcIixcbiAgICBcIm5vdF9tdWx0aXBsZV9vZlwiLFxuICAgIFwibm90X2Zpbml0ZVwiLFxuXSk7XG5leHBvcnQgY29uc3QgcXVvdGVsZXNzSnNvbiA9IChvYmopID0+IHtcbiAgICBjb25zdCBqc29uID0gSlNPTi5zdHJpbmdpZnkob2JqLCBudWxsLCAyKTtcbiAgICByZXR1cm4ganNvbi5yZXBsYWNlKC9cIihbXlwiXSspXCI6L2csIFwiJDE6XCIpO1xufTtcbmV4cG9ydCBjbGFzcyBab2RFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgICBnZXQgZXJyb3JzKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5pc3N1ZXM7XG4gICAgfVxuICAgIGNvbnN0cnVjdG9yKGlzc3Vlcykge1xuICAgICAgICBzdXBlcigpO1xuICAgICAgICB0aGlzLmlzc3VlcyA9IFtdO1xuICAgICAgICB0aGlzLmFkZElzc3VlID0gKHN1YikgPT4ge1xuICAgICAgICAgICAgdGhpcy5pc3N1ZXMgPSBbLi4udGhpcy5pc3N1ZXMsIHN1Yl07XG4gICAgICAgIH07XG4gICAgICAgIHRoaXMuYWRkSXNzdWVzID0gKHN1YnMgPSBbXSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5pc3N1ZXMgPSBbLi4udGhpcy5pc3N1ZXMsIC4uLnN1YnNdO1xuICAgICAgICB9O1xuICAgICAgICBjb25zdCBhY3R1YWxQcm90byA9IG5ldy50YXJnZXQucHJvdG90eXBlO1xuICAgICAgICBpZiAoT2JqZWN0LnNldFByb3RvdHlwZU9mKSB7XG4gICAgICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgYmFuL2JhblxuICAgICAgICAgICAgT2JqZWN0LnNldFByb3RvdHlwZU9mKHRoaXMsIGFjdHVhbFByb3RvKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuX19wcm90b19fID0gYWN0dWFsUHJvdG87XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5uYW1lID0gXCJab2RFcnJvclwiO1xuICAgICAgICB0aGlzLmlzc3VlcyA9IGlzc3VlcztcbiAgICB9XG4gICAgZm9ybWF0KF9tYXBwZXIpIHtcbiAgICAgICAgY29uc3QgbWFwcGVyID0gX21hcHBlciB8fFxuICAgICAgICAgICAgZnVuY3Rpb24gKGlzc3VlKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGlzc3VlLm1lc3NhZ2U7XG4gICAgICAgICAgICB9O1xuICAgICAgICBjb25zdCBmaWVsZEVycm9ycyA9IHsgX2Vycm9yczogW10gfTtcbiAgICAgICAgY29uc3QgcHJvY2Vzc0Vycm9yID0gKGVycm9yKSA9PiB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGlzc3VlIG9mIGVycm9yLmlzc3Vlcykge1xuICAgICAgICAgICAgICAgIGlmIChpc3N1ZS5jb2RlID09PSBcImludmFsaWRfdW5pb25cIikge1xuICAgICAgICAgICAgICAgICAgICBpc3N1ZS51bmlvbkVycm9ycy5tYXAocHJvY2Vzc0Vycm9yKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSBpZiAoaXNzdWUuY29kZSA9PT0gXCJpbnZhbGlkX3JldHVybl90eXBlXCIpIHtcbiAgICAgICAgICAgICAgICAgICAgcHJvY2Vzc0Vycm9yKGlzc3VlLnJldHVyblR5cGVFcnJvcik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2UgaWYgKGlzc3VlLmNvZGUgPT09IFwiaW52YWxpZF9hcmd1bWVudHNcIikge1xuICAgICAgICAgICAgICAgICAgICBwcm9jZXNzRXJyb3IoaXNzdWUuYXJndW1lbnRzRXJyb3IpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIGlmIChpc3N1ZS5wYXRoLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgICAgICBmaWVsZEVycm9ycy5fZXJyb3JzLnB1c2gobWFwcGVyKGlzc3VlKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBsZXQgY3VyciA9IGZpZWxkRXJyb3JzO1xuICAgICAgICAgICAgICAgICAgICBsZXQgaSA9IDA7XG4gICAgICAgICAgICAgICAgICAgIHdoaWxlIChpIDwgaXNzdWUucGF0aC5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGVsID0gaXNzdWUucGF0aFtpXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRlcm1pbmFsID0gaSA9PT0gaXNzdWUucGF0aC5sZW5ndGggLSAxO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF0ZXJtaW5hbCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN1cnJbZWxdID0gY3VycltlbF0gfHwgeyBfZXJyb3JzOiBbXSB9O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGlmICh0eXBlb2YgZWwgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyAgIGN1cnJbZWxdID0gY3VycltlbF0gfHwgeyBfZXJyb3JzOiBbXSB9O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIH0gZWxzZSBpZiAodHlwZW9mIGVsID09PSBcIm51bWJlclwiKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gICBjb25zdCBlcnJvckFycmF5OiBhbnkgPSBbXTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyAgIGVycm9yQXJyYXkuX2Vycm9ycyA9IFtdO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vICAgY3VycltlbF0gPSBjdXJyW2VsXSB8fCBlcnJvckFycmF5O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN1cnJbZWxdID0gY3VycltlbF0gfHwgeyBfZXJyb3JzOiBbXSB9O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN1cnJbZWxdLl9lcnJvcnMucHVzaChtYXBwZXIoaXNzdWUpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGN1cnIgPSBjdXJyW2VsXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGkrKztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgICAgcHJvY2Vzc0Vycm9yKHRoaXMpO1xuICAgICAgICByZXR1cm4gZmllbGRFcnJvcnM7XG4gICAgfVxuICAgIHN0YXRpYyBhc3NlcnQodmFsdWUpIHtcbiAgICAgICAgaWYgKCEodmFsdWUgaW5zdGFuY2VvZiBab2RFcnJvcikpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTm90IGEgWm9kRXJyb3I6ICR7dmFsdWV9YCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgdG9TdHJpbmcoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLm1lc3NhZ2U7XG4gICAgfVxuICAgIGdldCBtZXNzYWdlKCkge1xuICAgICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodGhpcy5pc3N1ZXMsIHV0aWwuanNvblN0cmluZ2lmeVJlcGxhY2VyLCAyKTtcbiAgICB9XG4gICAgZ2V0IGlzRW1wdHkoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmlzc3Vlcy5sZW5ndGggPT09IDA7XG4gICAgfVxuICAgIGZsYXR0ZW4obWFwcGVyID0gKGlzc3VlKSA9PiBpc3N1ZS5tZXNzYWdlKSB7XG4gICAgICAgIGNvbnN0IGZpZWxkRXJyb3JzID0ge307XG4gICAgICAgIGNvbnN0IGZvcm1FcnJvcnMgPSBbXTtcbiAgICAgICAgZm9yIChjb25zdCBzdWIgb2YgdGhpcy5pc3N1ZXMpIHtcbiAgICAgICAgICAgIGlmIChzdWIucGF0aC5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgZmllbGRFcnJvcnNbc3ViLnBhdGhbMF1dID0gZmllbGRFcnJvcnNbc3ViLnBhdGhbMF1dIHx8IFtdO1xuICAgICAgICAgICAgICAgIGZpZWxkRXJyb3JzW3N1Yi5wYXRoWzBdXS5wdXNoKG1hcHBlcihzdWIpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIGZvcm1FcnJvcnMucHVzaChtYXBwZXIoc3ViKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHsgZm9ybUVycm9ycywgZmllbGRFcnJvcnMgfTtcbiAgICB9XG4gICAgZ2V0IGZvcm1FcnJvcnMoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmZsYXR0ZW4oKTtcbiAgICB9XG59XG5ab2RFcnJvci5jcmVhdGUgPSAoaXNzdWVzKSA9PiB7XG4gICAgY29uc3QgZXJyb3IgPSBuZXcgWm9kRXJyb3IoaXNzdWVzKTtcbiAgICByZXR1cm4gZXJyb3I7XG59O1xuIiwiaW1wb3J0IHsgWm9kSXNzdWVDb2RlIH0gZnJvbSBcIi4uL1pvZEVycm9yLmpzXCI7XG5pbXBvcnQgeyB1dGlsLCBab2RQYXJzZWRUeXBlIH0gZnJvbSBcIi4uL2hlbHBlcnMvdXRpbC5qc1wiO1xuY29uc3QgZXJyb3JNYXAgPSAoaXNzdWUsIF9jdHgpID0+IHtcbiAgICBsZXQgbWVzc2FnZTtcbiAgICBzd2l0Y2ggKGlzc3VlLmNvZGUpIHtcbiAgICAgICAgY2FzZSBab2RJc3N1ZUNvZGUuaW52YWxpZF90eXBlOlxuICAgICAgICAgICAgaWYgKGlzc3VlLnJlY2VpdmVkID09PSBab2RQYXJzZWRUeXBlLnVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIG1lc3NhZ2UgPSBcIlJlcXVpcmVkXCI7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBtZXNzYWdlID0gYEV4cGVjdGVkICR7aXNzdWUuZXhwZWN0ZWR9LCByZWNlaXZlZCAke2lzc3VlLnJlY2VpdmVkfWA7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBab2RJc3N1ZUNvZGUuaW52YWxpZF9saXRlcmFsOlxuICAgICAgICAgICAgbWVzc2FnZSA9IGBJbnZhbGlkIGxpdGVyYWwgdmFsdWUsIGV4cGVjdGVkICR7SlNPTi5zdHJpbmdpZnkoaXNzdWUuZXhwZWN0ZWQsIHV0aWwuanNvblN0cmluZ2lmeVJlcGxhY2VyKX1gO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgWm9kSXNzdWVDb2RlLnVucmVjb2duaXplZF9rZXlzOlxuICAgICAgICAgICAgbWVzc2FnZSA9IGBVbnJlY29nbml6ZWQga2V5KHMpIGluIG9iamVjdDogJHt1dGlsLmpvaW5WYWx1ZXMoaXNzdWUua2V5cywgXCIsIFwiKX1gO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgWm9kSXNzdWVDb2RlLmludmFsaWRfdW5pb246XG4gICAgICAgICAgICBtZXNzYWdlID0gYEludmFsaWQgaW5wdXRgO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgWm9kSXNzdWVDb2RlLmludmFsaWRfdW5pb25fZGlzY3JpbWluYXRvcjpcbiAgICAgICAgICAgIG1lc3NhZ2UgPSBgSW52YWxpZCBkaXNjcmltaW5hdG9yIHZhbHVlLiBFeHBlY3RlZCAke3V0aWwuam9pblZhbHVlcyhpc3N1ZS5vcHRpb25zKX1gO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgWm9kSXNzdWVDb2RlLmludmFsaWRfZW51bV92YWx1ZTpcbiAgICAgICAgICAgIG1lc3NhZ2UgPSBgSW52YWxpZCBlbnVtIHZhbHVlLiBFeHBlY3RlZCAke3V0aWwuam9pblZhbHVlcyhpc3N1ZS5vcHRpb25zKX0sIHJlY2VpdmVkICcke2lzc3VlLnJlY2VpdmVkfSdgO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgWm9kSXNzdWVDb2RlLmludmFsaWRfYXJndW1lbnRzOlxuICAgICAgICAgICAgbWVzc2FnZSA9IGBJbnZhbGlkIGZ1bmN0aW9uIGFyZ3VtZW50c2A7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBab2RJc3N1ZUNvZGUuaW52YWxpZF9yZXR1cm5fdHlwZTpcbiAgICAgICAgICAgIG1lc3NhZ2UgPSBgSW52YWxpZCBmdW5jdGlvbiByZXR1cm4gdHlwZWA7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBab2RJc3N1ZUNvZGUuaW52YWxpZF9kYXRlOlxuICAgICAgICAgICAgbWVzc2FnZSA9IGBJbnZhbGlkIGRhdGVgO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgWm9kSXNzdWVDb2RlLmludmFsaWRfc3RyaW5nOlxuICAgICAgICAgICAgaWYgKHR5cGVvZiBpc3N1ZS52YWxpZGF0aW9uID09PSBcIm9iamVjdFwiKSB7XG4gICAgICAgICAgICAgICAgaWYgKFwiaW5jbHVkZXNcIiBpbiBpc3N1ZS52YWxpZGF0aW9uKSB7XG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2UgPSBgSW52YWxpZCBpbnB1dDogbXVzdCBpbmNsdWRlIFwiJHtpc3N1ZS52YWxpZGF0aW9uLmluY2x1ZGVzfVwiYDtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBpc3N1ZS52YWxpZGF0aW9uLnBvc2l0aW9uID09PSBcIm51bWJlclwiKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlID0gYCR7bWVzc2FnZX0gYXQgb25lIG9yIG1vcmUgcG9zaXRpb25zIGdyZWF0ZXIgdGhhbiBvciBlcXVhbCB0byAke2lzc3VlLnZhbGlkYXRpb24ucG9zaXRpb259YDtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIGlmIChcInN0YXJ0c1dpdGhcIiBpbiBpc3N1ZS52YWxpZGF0aW9uKSB7XG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2UgPSBgSW52YWxpZCBpbnB1dDogbXVzdCBzdGFydCB3aXRoIFwiJHtpc3N1ZS52YWxpZGF0aW9uLnN0YXJ0c1dpdGh9XCJgO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIGlmIChcImVuZHNXaXRoXCIgaW4gaXNzdWUudmFsaWRhdGlvbikge1xuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlID0gYEludmFsaWQgaW5wdXQ6IG11c3QgZW5kIHdpdGggXCIke2lzc3VlLnZhbGlkYXRpb24uZW5kc1dpdGh9XCJgO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdXRpbC5hc3NlcnROZXZlcihpc3N1ZS52YWxpZGF0aW9uKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChpc3N1ZS52YWxpZGF0aW9uICE9PSBcInJlZ2V4XCIpIHtcbiAgICAgICAgICAgICAgICBtZXNzYWdlID0gYEludmFsaWQgJHtpc3N1ZS52YWxpZGF0aW9ufWA7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBtZXNzYWdlID0gXCJJbnZhbGlkXCI7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBab2RJc3N1ZUNvZGUudG9vX3NtYWxsOlxuICAgICAgICAgICAgaWYgKGlzc3VlLnR5cGUgPT09IFwiYXJyYXlcIilcbiAgICAgICAgICAgICAgICBtZXNzYWdlID0gYEFycmF5IG11c3QgY29udGFpbiAke2lzc3VlLmV4YWN0ID8gXCJleGFjdGx5XCIgOiBpc3N1ZS5pbmNsdXNpdmUgPyBgYXQgbGVhc3RgIDogYG1vcmUgdGhhbmB9ICR7aXNzdWUubWluaW11bX0gZWxlbWVudChzKWA7XG4gICAgICAgICAgICBlbHNlIGlmIChpc3N1ZS50eXBlID09PSBcInN0cmluZ1wiKVxuICAgICAgICAgICAgICAgIG1lc3NhZ2UgPSBgU3RyaW5nIG11c3QgY29udGFpbiAke2lzc3VlLmV4YWN0ID8gXCJleGFjdGx5XCIgOiBpc3N1ZS5pbmNsdXNpdmUgPyBgYXQgbGVhc3RgIDogYG92ZXJgfSAke2lzc3VlLm1pbmltdW19IGNoYXJhY3RlcihzKWA7XG4gICAgICAgICAgICBlbHNlIGlmIChpc3N1ZS50eXBlID09PSBcIm51bWJlclwiKVxuICAgICAgICAgICAgICAgIG1lc3NhZ2UgPSBgTnVtYmVyIG11c3QgYmUgJHtpc3N1ZS5leGFjdCA/IGBleGFjdGx5IGVxdWFsIHRvIGAgOiBpc3N1ZS5pbmNsdXNpdmUgPyBgZ3JlYXRlciB0aGFuIG9yIGVxdWFsIHRvIGAgOiBgZ3JlYXRlciB0aGFuIGB9JHtpc3N1ZS5taW5pbXVtfWA7XG4gICAgICAgICAgICBlbHNlIGlmIChpc3N1ZS50eXBlID09PSBcImRhdGVcIilcbiAgICAgICAgICAgICAgICBtZXNzYWdlID0gYERhdGUgbXVzdCBiZSAke2lzc3VlLmV4YWN0ID8gYGV4YWN0bHkgZXF1YWwgdG8gYCA6IGlzc3VlLmluY2x1c2l2ZSA/IGBncmVhdGVyIHRoYW4gb3IgZXF1YWwgdG8gYCA6IGBncmVhdGVyIHRoYW4gYH0ke25ldyBEYXRlKE51bWJlcihpc3N1ZS5taW5pbXVtKSl9YDtcbiAgICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgICAgICBtZXNzYWdlID0gXCJJbnZhbGlkIGlucHV0XCI7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBab2RJc3N1ZUNvZGUudG9vX2JpZzpcbiAgICAgICAgICAgIGlmIChpc3N1ZS50eXBlID09PSBcImFycmF5XCIpXG4gICAgICAgICAgICAgICAgbWVzc2FnZSA9IGBBcnJheSBtdXN0IGNvbnRhaW4gJHtpc3N1ZS5leGFjdCA/IGBleGFjdGx5YCA6IGlzc3VlLmluY2x1c2l2ZSA/IGBhdCBtb3N0YCA6IGBsZXNzIHRoYW5gfSAke2lzc3VlLm1heGltdW19IGVsZW1lbnQocylgO1xuICAgICAgICAgICAgZWxzZSBpZiAoaXNzdWUudHlwZSA9PT0gXCJzdHJpbmdcIilcbiAgICAgICAgICAgICAgICBtZXNzYWdlID0gYFN0cmluZyBtdXN0IGNvbnRhaW4gJHtpc3N1ZS5leGFjdCA/IGBleGFjdGx5YCA6IGlzc3VlLmluY2x1c2l2ZSA/IGBhdCBtb3N0YCA6IGB1bmRlcmB9ICR7aXNzdWUubWF4aW11bX0gY2hhcmFjdGVyKHMpYDtcbiAgICAgICAgICAgIGVsc2UgaWYgKGlzc3VlLnR5cGUgPT09IFwibnVtYmVyXCIpXG4gICAgICAgICAgICAgICAgbWVzc2FnZSA9IGBOdW1iZXIgbXVzdCBiZSAke2lzc3VlLmV4YWN0ID8gYGV4YWN0bHlgIDogaXNzdWUuaW5jbHVzaXZlID8gYGxlc3MgdGhhbiBvciBlcXVhbCB0b2AgOiBgbGVzcyB0aGFuYH0gJHtpc3N1ZS5tYXhpbXVtfWA7XG4gICAgICAgICAgICBlbHNlIGlmIChpc3N1ZS50eXBlID09PSBcImJpZ2ludFwiKVxuICAgICAgICAgICAgICAgIG1lc3NhZ2UgPSBgQmlnSW50IG11c3QgYmUgJHtpc3N1ZS5leGFjdCA/IGBleGFjdGx5YCA6IGlzc3VlLmluY2x1c2l2ZSA/IGBsZXNzIHRoYW4gb3IgZXF1YWwgdG9gIDogYGxlc3MgdGhhbmB9ICR7aXNzdWUubWF4aW11bX1gO1xuICAgICAgICAgICAgZWxzZSBpZiAoaXNzdWUudHlwZSA9PT0gXCJkYXRlXCIpXG4gICAgICAgICAgICAgICAgbWVzc2FnZSA9IGBEYXRlIG11c3QgYmUgJHtpc3N1ZS5leGFjdCA/IGBleGFjdGx5YCA6IGlzc3VlLmluY2x1c2l2ZSA/IGBzbWFsbGVyIHRoYW4gb3IgZXF1YWwgdG9gIDogYHNtYWxsZXIgdGhhbmB9ICR7bmV3IERhdGUoTnVtYmVyKGlzc3VlLm1heGltdW0pKX1gO1xuICAgICAgICAgICAgZWxzZVxuICAgICAgICAgICAgICAgIG1lc3NhZ2UgPSBcIkludmFsaWQgaW5wdXRcIjtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFpvZElzc3VlQ29kZS5jdXN0b206XG4gICAgICAgICAgICBtZXNzYWdlID0gYEludmFsaWQgaW5wdXRgO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgWm9kSXNzdWVDb2RlLmludmFsaWRfaW50ZXJzZWN0aW9uX3R5cGVzOlxuICAgICAgICAgICAgbWVzc2FnZSA9IGBJbnRlcnNlY3Rpb24gcmVzdWx0cyBjb3VsZCBub3QgYmUgbWVyZ2VkYDtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFpvZElzc3VlQ29kZS5ub3RfbXVsdGlwbGVfb2Y6XG4gICAgICAgICAgICBtZXNzYWdlID0gYE51bWJlciBtdXN0IGJlIGEgbXVsdGlwbGUgb2YgJHtpc3N1ZS5tdWx0aXBsZU9mfWA7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBab2RJc3N1ZUNvZGUubm90X2Zpbml0ZTpcbiAgICAgICAgICAgIG1lc3NhZ2UgPSBcIk51bWJlciBtdXN0IGJlIGZpbml0ZVwiO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICBtZXNzYWdlID0gX2N0eC5kZWZhdWx0RXJyb3I7XG4gICAgICAgICAgICB1dGlsLmFzc2VydE5ldmVyKGlzc3VlKTtcbiAgICB9XG4gICAgcmV0dXJuIHsgbWVzc2FnZSB9O1xufTtcbmV4cG9ydCBkZWZhdWx0IGVycm9yTWFwO1xuIiwiaW1wb3J0IGRlZmF1bHRFcnJvck1hcCBmcm9tIFwiLi9sb2NhbGVzL2VuLmpzXCI7XG5sZXQgb3ZlcnJpZGVFcnJvck1hcCA9IGRlZmF1bHRFcnJvck1hcDtcbmV4cG9ydCB7IGRlZmF1bHRFcnJvck1hcCB9O1xuZXhwb3J0IGZ1bmN0aW9uIHNldEVycm9yTWFwKG1hcCkge1xuICAgIG92ZXJyaWRlRXJyb3JNYXAgPSBtYXA7XG59XG5leHBvcnQgZnVuY3Rpb24gZ2V0RXJyb3JNYXAoKSB7XG4gICAgcmV0dXJuIG92ZXJyaWRlRXJyb3JNYXA7XG59XG4iLCJpbXBvcnQgeyBnZXRFcnJvck1hcCB9IGZyb20gXCIuLi9lcnJvcnMuanNcIjtcbmltcG9ydCBkZWZhdWx0RXJyb3JNYXAgZnJvbSBcIi4uL2xvY2FsZXMvZW4uanNcIjtcbmV4cG9ydCBjb25zdCBtYWtlSXNzdWUgPSAocGFyYW1zKSA9PiB7XG4gICAgY29uc3QgeyBkYXRhLCBwYXRoLCBlcnJvck1hcHMsIGlzc3VlRGF0YSB9ID0gcGFyYW1zO1xuICAgIGNvbnN0IGZ1bGxQYXRoID0gWy4uLnBhdGgsIC4uLihpc3N1ZURhdGEucGF0aCB8fCBbXSldO1xuICAgIGNvbnN0IGZ1bGxJc3N1ZSA9IHtcbiAgICAgICAgLi4uaXNzdWVEYXRhLFxuICAgICAgICBwYXRoOiBmdWxsUGF0aCxcbiAgICB9O1xuICAgIGlmIChpc3N1ZURhdGEubWVzc2FnZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAuLi5pc3N1ZURhdGEsXG4gICAgICAgICAgICBwYXRoOiBmdWxsUGF0aCxcbiAgICAgICAgICAgIG1lc3NhZ2U6IGlzc3VlRGF0YS5tZXNzYWdlLFxuICAgICAgICB9O1xuICAgIH1cbiAgICBsZXQgZXJyb3JNZXNzYWdlID0gXCJcIjtcbiAgICBjb25zdCBtYXBzID0gZXJyb3JNYXBzXG4gICAgICAgIC5maWx0ZXIoKG0pID0+ICEhbSlcbiAgICAgICAgLnNsaWNlKClcbiAgICAgICAgLnJldmVyc2UoKTtcbiAgICBmb3IgKGNvbnN0IG1hcCBvZiBtYXBzKSB7XG4gICAgICAgIGVycm9yTWVzc2FnZSA9IG1hcChmdWxsSXNzdWUsIHsgZGF0YSwgZGVmYXVsdEVycm9yOiBlcnJvck1lc3NhZ2UgfSkubWVzc2FnZTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgICAgLi4uaXNzdWVEYXRhLFxuICAgICAgICBwYXRoOiBmdWxsUGF0aCxcbiAgICAgICAgbWVzc2FnZTogZXJyb3JNZXNzYWdlLFxuICAgIH07XG59O1xuZXhwb3J0IGNvbnN0IEVNUFRZX1BBVEggPSBbXTtcbmV4cG9ydCBmdW5jdGlvbiBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIGlzc3VlRGF0YSkge1xuICAgIGNvbnN0IG92ZXJyaWRlTWFwID0gZ2V0RXJyb3JNYXAoKTtcbiAgICBjb25zdCBpc3N1ZSA9IG1ha2VJc3N1ZSh7XG4gICAgICAgIGlzc3VlRGF0YTogaXNzdWVEYXRhLFxuICAgICAgICBkYXRhOiBjdHguZGF0YSxcbiAgICAgICAgcGF0aDogY3R4LnBhdGgsXG4gICAgICAgIGVycm9yTWFwczogW1xuICAgICAgICAgICAgY3R4LmNvbW1vbi5jb250ZXh0dWFsRXJyb3JNYXAsIC8vIGNvbnRleHR1YWwgZXJyb3IgbWFwIGlzIGZpcnN0IHByaW9yaXR5XG4gICAgICAgICAgICBjdHguc2NoZW1hRXJyb3JNYXAsIC8vIHRoZW4gc2NoZW1hLWJvdW5kIG1hcCBpZiBhdmFpbGFibGVcbiAgICAgICAgICAgIG92ZXJyaWRlTWFwLCAvLyB0aGVuIGdsb2JhbCBvdmVycmlkZSBtYXBcbiAgICAgICAgICAgIG92ZXJyaWRlTWFwID09PSBkZWZhdWx0RXJyb3JNYXAgPyB1bmRlZmluZWQgOiBkZWZhdWx0RXJyb3JNYXAsIC8vIHRoZW4gZ2xvYmFsIGRlZmF1bHQgbWFwXG4gICAgICAgIF0uZmlsdGVyKCh4KSA9PiAhIXgpLFxuICAgIH0pO1xuICAgIGN0eC5jb21tb24uaXNzdWVzLnB1c2goaXNzdWUpO1xufVxuZXhwb3J0IGNsYXNzIFBhcnNlU3RhdHVzIHtcbiAgICBjb25zdHJ1Y3RvcigpIHtcbiAgICAgICAgdGhpcy52YWx1ZSA9IFwidmFsaWRcIjtcbiAgICB9XG4gICAgZGlydHkoKSB7XG4gICAgICAgIGlmICh0aGlzLnZhbHVlID09PSBcInZhbGlkXCIpXG4gICAgICAgICAgICB0aGlzLnZhbHVlID0gXCJkaXJ0eVwiO1xuICAgIH1cbiAgICBhYm9ydCgpIHtcbiAgICAgICAgaWYgKHRoaXMudmFsdWUgIT09IFwiYWJvcnRlZFwiKVxuICAgICAgICAgICAgdGhpcy52YWx1ZSA9IFwiYWJvcnRlZFwiO1xuICAgIH1cbiAgICBzdGF0aWMgbWVyZ2VBcnJheShzdGF0dXMsIHJlc3VsdHMpIHtcbiAgICAgICAgY29uc3QgYXJyYXlWYWx1ZSA9IFtdO1xuICAgICAgICBmb3IgKGNvbnN0IHMgb2YgcmVzdWx0cykge1xuICAgICAgICAgICAgaWYgKHMuc3RhdHVzID09PSBcImFib3J0ZWRcIilcbiAgICAgICAgICAgICAgICByZXR1cm4gSU5WQUxJRDtcbiAgICAgICAgICAgIGlmIChzLnN0YXR1cyA9PT0gXCJkaXJ0eVwiKVxuICAgICAgICAgICAgICAgIHN0YXR1cy5kaXJ0eSgpO1xuICAgICAgICAgICAgYXJyYXlWYWx1ZS5wdXNoKHMudmFsdWUpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB7IHN0YXR1czogc3RhdHVzLnZhbHVlLCB2YWx1ZTogYXJyYXlWYWx1ZSB9O1xuICAgIH1cbiAgICBzdGF0aWMgYXN5bmMgbWVyZ2VPYmplY3RBc3luYyhzdGF0dXMsIHBhaXJzKSB7XG4gICAgICAgIGNvbnN0IHN5bmNQYWlycyA9IFtdO1xuICAgICAgICBmb3IgKGNvbnN0IHBhaXIgb2YgcGFpcnMpIHtcbiAgICAgICAgICAgIGNvbnN0IGtleSA9IGF3YWl0IHBhaXIua2V5O1xuICAgICAgICAgICAgY29uc3QgdmFsdWUgPSBhd2FpdCBwYWlyLnZhbHVlO1xuICAgICAgICAgICAgc3luY1BhaXJzLnB1c2goe1xuICAgICAgICAgICAgICAgIGtleSxcbiAgICAgICAgICAgICAgICB2YWx1ZSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBQYXJzZVN0YXR1cy5tZXJnZU9iamVjdFN5bmMoc3RhdHVzLCBzeW5jUGFpcnMpO1xuICAgIH1cbiAgICBzdGF0aWMgbWVyZ2VPYmplY3RTeW5jKHN0YXR1cywgcGFpcnMpIHtcbiAgICAgICAgY29uc3QgZmluYWxPYmplY3QgPSB7fTtcbiAgICAgICAgZm9yIChjb25zdCBwYWlyIG9mIHBhaXJzKSB7XG4gICAgICAgICAgICBjb25zdCB7IGtleSwgdmFsdWUgfSA9IHBhaXI7XG4gICAgICAgICAgICBpZiAoa2V5LnN0YXR1cyA9PT0gXCJhYm9ydGVkXCIpXG4gICAgICAgICAgICAgICAgcmV0dXJuIElOVkFMSUQ7XG4gICAgICAgICAgICBpZiAodmFsdWUuc3RhdHVzID09PSBcImFib3J0ZWRcIilcbiAgICAgICAgICAgICAgICByZXR1cm4gSU5WQUxJRDtcbiAgICAgICAgICAgIGlmIChrZXkuc3RhdHVzID09PSBcImRpcnR5XCIpXG4gICAgICAgICAgICAgICAgc3RhdHVzLmRpcnR5KCk7XG4gICAgICAgICAgICBpZiAodmFsdWUuc3RhdHVzID09PSBcImRpcnR5XCIpXG4gICAgICAgICAgICAgICAgc3RhdHVzLmRpcnR5KCk7XG4gICAgICAgICAgICBpZiAoa2V5LnZhbHVlICE9PSBcIl9fcHJvdG9fX1wiICYmICh0eXBlb2YgdmFsdWUudmFsdWUgIT09IFwidW5kZWZpbmVkXCIgfHwgcGFpci5hbHdheXNTZXQpKSB7XG4gICAgICAgICAgICAgICAgZmluYWxPYmplY3Rba2V5LnZhbHVlXSA9IHZhbHVlLnZhbHVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB7IHN0YXR1czogc3RhdHVzLnZhbHVlLCB2YWx1ZTogZmluYWxPYmplY3QgfTtcbiAgICB9XG59XG5leHBvcnQgY29uc3QgSU5WQUxJRCA9IE9iamVjdC5mcmVlemUoe1xuICAgIHN0YXR1czogXCJhYm9ydGVkXCIsXG59KTtcbmV4cG9ydCBjb25zdCBESVJUWSA9ICh2YWx1ZSkgPT4gKHsgc3RhdHVzOiBcImRpcnR5XCIsIHZhbHVlIH0pO1xuZXhwb3J0IGNvbnN0IE9LID0gKHZhbHVlKSA9PiAoeyBzdGF0dXM6IFwidmFsaWRcIiwgdmFsdWUgfSk7XG5leHBvcnQgY29uc3QgaXNBYm9ydGVkID0gKHgpID0+IHguc3RhdHVzID09PSBcImFib3J0ZWRcIjtcbmV4cG9ydCBjb25zdCBpc0RpcnR5ID0gKHgpID0+IHguc3RhdHVzID09PSBcImRpcnR5XCI7XG5leHBvcnQgY29uc3QgaXNWYWxpZCA9ICh4KSA9PiB4LnN0YXR1cyA9PT0gXCJ2YWxpZFwiO1xuZXhwb3J0IGNvbnN0IGlzQXN5bmMgPSAoeCkgPT4gdHlwZW9mIFByb21pc2UgIT09IFwidW5kZWZpbmVkXCIgJiYgeCBpbnN0YW5jZW9mIFByb21pc2U7XG4iLCJleHBvcnQgdmFyIGVycm9yVXRpbDtcbihmdW5jdGlvbiAoZXJyb3JVdGlsKSB7XG4gICAgZXJyb3JVdGlsLmVyclRvT2JqID0gKG1lc3NhZ2UpID0+IHR5cGVvZiBtZXNzYWdlID09PSBcInN0cmluZ1wiID8geyBtZXNzYWdlIH0gOiBtZXNzYWdlIHx8IHt9O1xuICAgIC8vIGJpb21lLWlnbm9yZSBsaW50OlxuICAgIGVycm9yVXRpbC50b1N0cmluZyA9IChtZXNzYWdlKSA9PiB0eXBlb2YgbWVzc2FnZSA9PT0gXCJzdHJpbmdcIiA/IG1lc3NhZ2UgOiBtZXNzYWdlPy5tZXNzYWdlO1xufSkoZXJyb3JVdGlsIHx8IChlcnJvclV0aWwgPSB7fSkpO1xuIiwiaW1wb3J0IHsgWm9kRXJyb3IsIFpvZElzc3VlQ29kZSwgfSBmcm9tIFwiLi9ab2RFcnJvci5qc1wiO1xuaW1wb3J0IHsgZGVmYXVsdEVycm9yTWFwLCBnZXRFcnJvck1hcCB9IGZyb20gXCIuL2Vycm9ycy5qc1wiO1xuaW1wb3J0IHsgZXJyb3JVdGlsIH0gZnJvbSBcIi4vaGVscGVycy9lcnJvclV0aWwuanNcIjtcbmltcG9ydCB7IERJUlRZLCBJTlZBTElELCBPSywgUGFyc2VTdGF0dXMsIGFkZElzc3VlVG9Db250ZXh0LCBpc0Fib3J0ZWQsIGlzQXN5bmMsIGlzRGlydHksIGlzVmFsaWQsIG1ha2VJc3N1ZSwgfSBmcm9tIFwiLi9oZWxwZXJzL3BhcnNlVXRpbC5qc1wiO1xuaW1wb3J0IHsgdXRpbCwgWm9kUGFyc2VkVHlwZSwgZ2V0UGFyc2VkVHlwZSB9IGZyb20gXCIuL2hlbHBlcnMvdXRpbC5qc1wiO1xuY2xhc3MgUGFyc2VJbnB1dExhenlQYXRoIHtcbiAgICBjb25zdHJ1Y3RvcihwYXJlbnQsIHZhbHVlLCBwYXRoLCBrZXkpIHtcbiAgICAgICAgdGhpcy5fY2FjaGVkUGF0aCA9IFtdO1xuICAgICAgICB0aGlzLnBhcmVudCA9IHBhcmVudDtcbiAgICAgICAgdGhpcy5kYXRhID0gdmFsdWU7XG4gICAgICAgIHRoaXMuX3BhdGggPSBwYXRoO1xuICAgICAgICB0aGlzLl9rZXkgPSBrZXk7XG4gICAgfVxuICAgIGdldCBwYXRoKCkge1xuICAgICAgICBpZiAoIXRoaXMuX2NhY2hlZFBhdGgubGVuZ3RoKSB7XG4gICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheSh0aGlzLl9rZXkpKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fY2FjaGVkUGF0aC5wdXNoKC4uLnRoaXMuX3BhdGgsIC4uLnRoaXMuX2tleSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9jYWNoZWRQYXRoLnB1c2goLi4udGhpcy5fcGF0aCwgdGhpcy5fa2V5KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5fY2FjaGVkUGF0aDtcbiAgICB9XG59XG5jb25zdCBoYW5kbGVSZXN1bHQgPSAoY3R4LCByZXN1bHQpID0+IHtcbiAgICBpZiAoaXNWYWxpZChyZXN1bHQpKSB7XG4gICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIGRhdGE6IHJlc3VsdC52YWx1ZSB9O1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgaWYgKCFjdHguY29tbW9uLmlzc3Vlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIlZhbGlkYXRpb24gZmFpbGVkIGJ1dCBubyBpc3N1ZXMgZGV0ZWN0ZWQuXCIpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICAgIGdldCBlcnJvcigpIHtcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fZXJyb3IpXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLl9lcnJvcjtcbiAgICAgICAgICAgICAgICBjb25zdCBlcnJvciA9IG5ldyBab2RFcnJvcihjdHguY29tbW9uLmlzc3Vlcyk7XG4gICAgICAgICAgICAgICAgdGhpcy5fZXJyb3IgPSBlcnJvcjtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5fZXJyb3I7XG4gICAgICAgICAgICB9LFxuICAgICAgICB9O1xuICAgIH1cbn07XG5mdW5jdGlvbiBwcm9jZXNzQ3JlYXRlUGFyYW1zKHBhcmFtcykge1xuICAgIGlmICghcGFyYW1zKVxuICAgICAgICByZXR1cm4ge307XG4gICAgY29uc3QgeyBlcnJvck1hcCwgaW52YWxpZF90eXBlX2Vycm9yLCByZXF1aXJlZF9lcnJvciwgZGVzY3JpcHRpb24gfSA9IHBhcmFtcztcbiAgICBpZiAoZXJyb3JNYXAgJiYgKGludmFsaWRfdHlwZV9lcnJvciB8fCByZXF1aXJlZF9lcnJvcikpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW4ndCB1c2UgXCJpbnZhbGlkX3R5cGVfZXJyb3JcIiBvciBcInJlcXVpcmVkX2Vycm9yXCIgaW4gY29uanVuY3Rpb24gd2l0aCBjdXN0b20gZXJyb3IgbWFwLmApO1xuICAgIH1cbiAgICBpZiAoZXJyb3JNYXApXG4gICAgICAgIHJldHVybiB7IGVycm9yTWFwOiBlcnJvck1hcCwgZGVzY3JpcHRpb24gfTtcbiAgICBjb25zdCBjdXN0b21NYXAgPSAoaXNzLCBjdHgpID0+IHtcbiAgICAgICAgY29uc3QgeyBtZXNzYWdlIH0gPSBwYXJhbXM7XG4gICAgICAgIGlmIChpc3MuY29kZSA9PT0gXCJpbnZhbGlkX2VudW1fdmFsdWVcIikge1xuICAgICAgICAgICAgcmV0dXJuIHsgbWVzc2FnZTogbWVzc2FnZSA/PyBjdHguZGVmYXVsdEVycm9yIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHR5cGVvZiBjdHguZGF0YSA9PT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICAgICAgcmV0dXJuIHsgbWVzc2FnZTogbWVzc2FnZSA/PyByZXF1aXJlZF9lcnJvciA/PyBjdHguZGVmYXVsdEVycm9yIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGlzcy5jb2RlICE9PSBcImludmFsaWRfdHlwZVwiKVxuICAgICAgICAgICAgcmV0dXJuIHsgbWVzc2FnZTogY3R4LmRlZmF1bHRFcnJvciB9O1xuICAgICAgICByZXR1cm4geyBtZXNzYWdlOiBtZXNzYWdlID8/IGludmFsaWRfdHlwZV9lcnJvciA/PyBjdHguZGVmYXVsdEVycm9yIH07XG4gICAgfTtcbiAgICByZXR1cm4geyBlcnJvck1hcDogY3VzdG9tTWFwLCBkZXNjcmlwdGlvbiB9O1xufVxuZXhwb3J0IGNsYXNzIFpvZFR5cGUge1xuICAgIGdldCBkZXNjcmlwdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2RlZi5kZXNjcmlwdGlvbjtcbiAgICB9XG4gICAgX2dldFR5cGUoaW5wdXQpIHtcbiAgICAgICAgcmV0dXJuIGdldFBhcnNlZFR5cGUoaW5wdXQuZGF0YSk7XG4gICAgfVxuICAgIF9nZXRPclJldHVybkN0eChpbnB1dCwgY3R4KSB7XG4gICAgICAgIHJldHVybiAoY3R4IHx8IHtcbiAgICAgICAgICAgIGNvbW1vbjogaW5wdXQucGFyZW50LmNvbW1vbixcbiAgICAgICAgICAgIGRhdGE6IGlucHV0LmRhdGEsXG4gICAgICAgICAgICBwYXJzZWRUeXBlOiBnZXRQYXJzZWRUeXBlKGlucHV0LmRhdGEpLFxuICAgICAgICAgICAgc2NoZW1hRXJyb3JNYXA6IHRoaXMuX2RlZi5lcnJvck1hcCxcbiAgICAgICAgICAgIHBhdGg6IGlucHV0LnBhdGgsXG4gICAgICAgICAgICBwYXJlbnQ6IGlucHV0LnBhcmVudCxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIF9wcm9jZXNzSW5wdXRQYXJhbXMoaW5wdXQpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1czogbmV3IFBhcnNlU3RhdHVzKCksXG4gICAgICAgICAgICBjdHg6IHtcbiAgICAgICAgICAgICAgICBjb21tb246IGlucHV0LnBhcmVudC5jb21tb24sXG4gICAgICAgICAgICAgICAgZGF0YTogaW5wdXQuZGF0YSxcbiAgICAgICAgICAgICAgICBwYXJzZWRUeXBlOiBnZXRQYXJzZWRUeXBlKGlucHV0LmRhdGEpLFxuICAgICAgICAgICAgICAgIHNjaGVtYUVycm9yTWFwOiB0aGlzLl9kZWYuZXJyb3JNYXAsXG4gICAgICAgICAgICAgICAgcGF0aDogaW5wdXQucGF0aCxcbiAgICAgICAgICAgICAgICBwYXJlbnQ6IGlucHV0LnBhcmVudCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH07XG4gICAgfVxuICAgIF9wYXJzZVN5bmMoaW5wdXQpIHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gdGhpcy5fcGFyc2UoaW5wdXQpO1xuICAgICAgICBpZiAoaXNBc3luYyhyZXN1bHQpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jaHJvbm91cyBwYXJzZSBlbmNvdW50ZXJlZCBwcm9taXNlLlwiKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cbiAgICBfcGFyc2VBc3luYyhpbnB1dCkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSB0aGlzLl9wYXJzZShpbnB1dCk7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUocmVzdWx0KTtcbiAgICB9XG4gICAgcGFyc2UoZGF0YSwgcGFyYW1zKSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHRoaXMuc2FmZVBhcnNlKGRhdGEsIHBhcmFtcyk7XG4gICAgICAgIGlmIChyZXN1bHQuc3VjY2VzcylcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQuZGF0YTtcbiAgICAgICAgdGhyb3cgcmVzdWx0LmVycm9yO1xuICAgIH1cbiAgICBzYWZlUGFyc2UoZGF0YSwgcGFyYW1zKSB7XG4gICAgICAgIGNvbnN0IGN0eCA9IHtcbiAgICAgICAgICAgIGNvbW1vbjoge1xuICAgICAgICAgICAgICAgIGlzc3VlczogW10sXG4gICAgICAgICAgICAgICAgYXN5bmM6IHBhcmFtcz8uYXN5bmMgPz8gZmFsc2UsXG4gICAgICAgICAgICAgICAgY29udGV4dHVhbEVycm9yTWFwOiBwYXJhbXM/LmVycm9yTWFwLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHBhdGg6IHBhcmFtcz8ucGF0aCB8fCBbXSxcbiAgICAgICAgICAgIHNjaGVtYUVycm9yTWFwOiB0aGlzLl9kZWYuZXJyb3JNYXAsXG4gICAgICAgICAgICBwYXJlbnQ6IG51bGwsXG4gICAgICAgICAgICBkYXRhLFxuICAgICAgICAgICAgcGFyc2VkVHlwZTogZ2V0UGFyc2VkVHlwZShkYXRhKSxcbiAgICAgICAgfTtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gdGhpcy5fcGFyc2VTeW5jKHsgZGF0YSwgcGF0aDogY3R4LnBhdGgsIHBhcmVudDogY3R4IH0pO1xuICAgICAgICByZXR1cm4gaGFuZGxlUmVzdWx0KGN0eCwgcmVzdWx0KTtcbiAgICB9XG4gICAgXCJ+dmFsaWRhdGVcIihkYXRhKSB7XG4gICAgICAgIGNvbnN0IGN0eCA9IHtcbiAgICAgICAgICAgIGNvbW1vbjoge1xuICAgICAgICAgICAgICAgIGlzc3VlczogW10sXG4gICAgICAgICAgICAgICAgYXN5bmM6ICEhdGhpc1tcIn5zdGFuZGFyZFwiXS5hc3luYyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwYXRoOiBbXSxcbiAgICAgICAgICAgIHNjaGVtYUVycm9yTWFwOiB0aGlzLl9kZWYuZXJyb3JNYXAsXG4gICAgICAgICAgICBwYXJlbnQ6IG51bGwsXG4gICAgICAgICAgICBkYXRhLFxuICAgICAgICAgICAgcGFyc2VkVHlwZTogZ2V0UGFyc2VkVHlwZShkYXRhKSxcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKCF0aGlzW1wifnN0YW5kYXJkXCJdLmFzeW5jKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IHRoaXMuX3BhcnNlU3luYyh7IGRhdGEsIHBhdGg6IFtdLCBwYXJlbnQ6IGN0eCB9KTtcbiAgICAgICAgICAgICAgICByZXR1cm4gaXNWYWxpZChyZXN1bHQpXG4gICAgICAgICAgICAgICAgICAgID8ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWU6IHJlc3VsdC52YWx1ZSxcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICA6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlzc3VlczogY3R4LmNvbW1vbi5pc3N1ZXMsXG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAgICAgaWYgKGVycj8ubWVzc2FnZT8udG9Mb3dlckNhc2UoKT8uaW5jbHVkZXMoXCJlbmNvdW50ZXJlZFwiKSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzW1wifnN0YW5kYXJkXCJdLmFzeW5jID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY3R4LmNvbW1vbiA9IHtcbiAgICAgICAgICAgICAgICAgICAgaXNzdWVzOiBbXSxcbiAgICAgICAgICAgICAgICAgICAgYXN5bmM6IHRydWUsXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5fcGFyc2VBc3luYyh7IGRhdGEsIHBhdGg6IFtdLCBwYXJlbnQ6IGN0eCB9KS50aGVuKChyZXN1bHQpID0+IGlzVmFsaWQocmVzdWx0KVxuICAgICAgICAgICAgPyB7XG4gICAgICAgICAgICAgICAgdmFsdWU6IHJlc3VsdC52YWx1ZSxcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIDoge1xuICAgICAgICAgICAgICAgIGlzc3VlczogY3R4LmNvbW1vbi5pc3N1ZXMsXG4gICAgICAgICAgICB9KTtcbiAgICB9XG4gICAgYXN5bmMgcGFyc2VBc3luYyhkYXRhLCBwYXJhbXMpIHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5zYWZlUGFyc2VBc3luYyhkYXRhLCBwYXJhbXMpO1xuICAgICAgICBpZiAocmVzdWx0LnN1Y2Nlc3MpXG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0LmRhdGE7XG4gICAgICAgIHRocm93IHJlc3VsdC5lcnJvcjtcbiAgICB9XG4gICAgYXN5bmMgc2FmZVBhcnNlQXN5bmMoZGF0YSwgcGFyYW1zKSB7XG4gICAgICAgIGNvbnN0IGN0eCA9IHtcbiAgICAgICAgICAgIGNvbW1vbjoge1xuICAgICAgICAgICAgICAgIGlzc3VlczogW10sXG4gICAgICAgICAgICAgICAgY29udGV4dHVhbEVycm9yTWFwOiBwYXJhbXM/LmVycm9yTWFwLFxuICAgICAgICAgICAgICAgIGFzeW5jOiB0cnVlLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHBhdGg6IHBhcmFtcz8ucGF0aCB8fCBbXSxcbiAgICAgICAgICAgIHNjaGVtYUVycm9yTWFwOiB0aGlzLl9kZWYuZXJyb3JNYXAsXG4gICAgICAgICAgICBwYXJlbnQ6IG51bGwsXG4gICAgICAgICAgICBkYXRhLFxuICAgICAgICAgICAgcGFyc2VkVHlwZTogZ2V0UGFyc2VkVHlwZShkYXRhKSxcbiAgICAgICAgfTtcbiAgICAgICAgY29uc3QgbWF5YmVBc3luY1Jlc3VsdCA9IHRoaXMuX3BhcnNlKHsgZGF0YSwgcGF0aDogY3R4LnBhdGgsIHBhcmVudDogY3R4IH0pO1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCAoaXNBc3luYyhtYXliZUFzeW5jUmVzdWx0KSA/IG1heWJlQXN5bmNSZXN1bHQgOiBQcm9taXNlLnJlc29sdmUobWF5YmVBc3luY1Jlc3VsdCkpO1xuICAgICAgICByZXR1cm4gaGFuZGxlUmVzdWx0KGN0eCwgcmVzdWx0KTtcbiAgICB9XG4gICAgcmVmaW5lKGNoZWNrLCBtZXNzYWdlKSB7XG4gICAgICAgIGNvbnN0IGdldElzc3VlUHJvcGVydGllcyA9ICh2YWwpID0+IHtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgbWVzc2FnZSA9PT0gXCJzdHJpbmdcIiB8fCB0eXBlb2YgbWVzc2FnZSA9PT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICAgICAgICAgIHJldHVybiB7IG1lc3NhZ2UgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKHR5cGVvZiBtZXNzYWdlID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbWVzc2FnZSh2YWwpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG1lc3NhZ2U7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgICAgIHJldHVybiB0aGlzLl9yZWZpbmVtZW50KCh2YWwsIGN0eCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gY2hlY2sodmFsKTtcbiAgICAgICAgICAgIGNvbnN0IHNldEVycm9yID0gKCkgPT4gY3R4LmFkZElzc3VlKHtcbiAgICAgICAgICAgICAgICBjb2RlOiBab2RJc3N1ZUNvZGUuY3VzdG9tLFxuICAgICAgICAgICAgICAgIC4uLmdldElzc3VlUHJvcGVydGllcyh2YWwpLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBpZiAodHlwZW9mIFByb21pc2UgIT09IFwidW5kZWZpbmVkXCIgJiYgcmVzdWx0IGluc3RhbmNlb2YgUHJvbWlzZSkge1xuICAgICAgICAgICAgICAgIHJldHVybiByZXN1bHQudGhlbigoZGF0YSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIWRhdGEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldEVycm9yKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCFyZXN1bHQpIHtcbiAgICAgICAgICAgICAgICBzZXRFcnJvcigpO1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG4gICAgcmVmaW5lbWVudChjaGVjaywgcmVmaW5lbWVudERhdGEpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX3JlZmluZW1lbnQoKHZhbCwgY3R4KSA9PiB7XG4gICAgICAgICAgICBpZiAoIWNoZWNrKHZhbCkpIHtcbiAgICAgICAgICAgICAgICBjdHguYWRkSXNzdWUodHlwZW9mIHJlZmluZW1lbnREYXRhID09PSBcImZ1bmN0aW9uXCIgPyByZWZpbmVtZW50RGF0YSh2YWwsIGN0eCkgOiByZWZpbmVtZW50RGF0YSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cbiAgICBfcmVmaW5lbWVudChyZWZpbmVtZW50KSB7XG4gICAgICAgIHJldHVybiBuZXcgWm9kRWZmZWN0cyh7XG4gICAgICAgICAgICBzY2hlbWE6IHRoaXMsXG4gICAgICAgICAgICB0eXBlTmFtZTogWm9kRmlyc3RQYXJ0eVR5cGVLaW5kLlpvZEVmZmVjdHMsXG4gICAgICAgICAgICBlZmZlY3Q6IHsgdHlwZTogXCJyZWZpbmVtZW50XCIsIHJlZmluZW1lbnQgfSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHN1cGVyUmVmaW5lKHJlZmluZW1lbnQpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX3JlZmluZW1lbnQocmVmaW5lbWVudCk7XG4gICAgfVxuICAgIGNvbnN0cnVjdG9yKGRlZikge1xuICAgICAgICAvKiogQWxpYXMgb2Ygc2FmZVBhcnNlQXN5bmMgKi9cbiAgICAgICAgdGhpcy5zcGEgPSB0aGlzLnNhZmVQYXJzZUFzeW5jO1xuICAgICAgICB0aGlzLl9kZWYgPSBkZWY7XG4gICAgICAgIHRoaXMucGFyc2UgPSB0aGlzLnBhcnNlLmJpbmQodGhpcyk7XG4gICAgICAgIHRoaXMuc2FmZVBhcnNlID0gdGhpcy5zYWZlUGFyc2UuYmluZCh0aGlzKTtcbiAgICAgICAgdGhpcy5wYXJzZUFzeW5jID0gdGhpcy5wYXJzZUFzeW5jLmJpbmQodGhpcyk7XG4gICAgICAgIHRoaXMuc2FmZVBhcnNlQXN5bmMgPSB0aGlzLnNhZmVQYXJzZUFzeW5jLmJpbmQodGhpcyk7XG4gICAgICAgIHRoaXMuc3BhID0gdGhpcy5zcGEuYmluZCh0aGlzKTtcbiAgICAgICAgdGhpcy5yZWZpbmUgPSB0aGlzLnJlZmluZS5iaW5kKHRoaXMpO1xuICAgICAgICB0aGlzLnJlZmluZW1lbnQgPSB0aGlzLnJlZmluZW1lbnQuYmluZCh0aGlzKTtcbiAgICAgICAgdGhpcy5zdXBlclJlZmluZSA9IHRoaXMuc3VwZXJSZWZpbmUuYmluZCh0aGlzKTtcbiAgICAgICAgdGhpcy5vcHRpb25hbCA9IHRoaXMub3B0aW9uYWwuYmluZCh0aGlzKTtcbiAgICAgICAgdGhpcy5udWxsYWJsZSA9IHRoaXMubnVsbGFibGUuYmluZCh0aGlzKTtcbiAgICAgICAgdGhpcy5udWxsaXNoID0gdGhpcy5udWxsaXNoLmJpbmQodGhpcyk7XG4gICAgICAgIHRoaXMuYXJyYXkgPSB0aGlzLmFycmF5LmJpbmQodGhpcyk7XG4gICAgICAgIHRoaXMucHJvbWlzZSA9IHRoaXMucHJvbWlzZS5iaW5kKHRoaXMpO1xuICAgICAgICB0aGlzLm9yID0gdGhpcy5vci5iaW5kKHRoaXMpO1xuICAgICAgICB0aGlzLmFuZCA9IHRoaXMuYW5kLmJpbmQodGhpcyk7XG4gICAgICAgIHRoaXMudHJhbnNmb3JtID0gdGhpcy50cmFuc2Zvcm0uYmluZCh0aGlzKTtcbiAgICAgICAgdGhpcy5icmFuZCA9IHRoaXMuYnJhbmQuYmluZCh0aGlzKTtcbiAgICAgICAgdGhpcy5kZWZhdWx0ID0gdGhpcy5kZWZhdWx0LmJpbmQodGhpcyk7XG4gICAgICAgIHRoaXMuY2F0Y2ggPSB0aGlzLmNhdGNoLmJpbmQodGhpcyk7XG4gICAgICAgIHRoaXMuZGVzY3JpYmUgPSB0aGlzLmRlc2NyaWJlLmJpbmQodGhpcyk7XG4gICAgICAgIHRoaXMucGlwZSA9IHRoaXMucGlwZS5iaW5kKHRoaXMpO1xuICAgICAgICB0aGlzLnJlYWRvbmx5ID0gdGhpcy5yZWFkb25seS5iaW5kKHRoaXMpO1xuICAgICAgICB0aGlzLmlzTnVsbGFibGUgPSB0aGlzLmlzTnVsbGFibGUuYmluZCh0aGlzKTtcbiAgICAgICAgdGhpcy5pc09wdGlvbmFsID0gdGhpcy5pc09wdGlvbmFsLmJpbmQodGhpcyk7XG4gICAgICAgIHRoaXNbXCJ+c3RhbmRhcmRcIl0gPSB7XG4gICAgICAgICAgICB2ZXJzaW9uOiAxLFxuICAgICAgICAgICAgdmVuZG9yOiBcInpvZFwiLFxuICAgICAgICAgICAgdmFsaWRhdGU6IChkYXRhKSA9PiB0aGlzW1wifnZhbGlkYXRlXCJdKGRhdGEpLFxuICAgICAgICB9O1xuICAgIH1cbiAgICBvcHRpb25hbCgpIHtcbiAgICAgICAgcmV0dXJuIFpvZE9wdGlvbmFsLmNyZWF0ZSh0aGlzLCB0aGlzLl9kZWYpO1xuICAgIH1cbiAgICBudWxsYWJsZSgpIHtcbiAgICAgICAgcmV0dXJuIFpvZE51bGxhYmxlLmNyZWF0ZSh0aGlzLCB0aGlzLl9kZWYpO1xuICAgIH1cbiAgICBudWxsaXNoKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5udWxsYWJsZSgpLm9wdGlvbmFsKCk7XG4gICAgfVxuICAgIGFycmF5KCkge1xuICAgICAgICByZXR1cm4gWm9kQXJyYXkuY3JlYXRlKHRoaXMpO1xuICAgIH1cbiAgICBwcm9taXNlKCkge1xuICAgICAgICByZXR1cm4gWm9kUHJvbWlzZS5jcmVhdGUodGhpcywgdGhpcy5fZGVmKTtcbiAgICB9XG4gICAgb3Iob3B0aW9uKSB7XG4gICAgICAgIHJldHVybiBab2RVbmlvbi5jcmVhdGUoW3RoaXMsIG9wdGlvbl0sIHRoaXMuX2RlZik7XG4gICAgfVxuICAgIGFuZChpbmNvbWluZykge1xuICAgICAgICByZXR1cm4gWm9kSW50ZXJzZWN0aW9uLmNyZWF0ZSh0aGlzLCBpbmNvbWluZywgdGhpcy5fZGVmKTtcbiAgICB9XG4gICAgdHJhbnNmb3JtKHRyYW5zZm9ybSkge1xuICAgICAgICByZXR1cm4gbmV3IFpvZEVmZmVjdHMoe1xuICAgICAgICAgICAgLi4ucHJvY2Vzc0NyZWF0ZVBhcmFtcyh0aGlzLl9kZWYpLFxuICAgICAgICAgICAgc2NoZW1hOiB0aGlzLFxuICAgICAgICAgICAgdHlwZU5hbWU6IFpvZEZpcnN0UGFydHlUeXBlS2luZC5ab2RFZmZlY3RzLFxuICAgICAgICAgICAgZWZmZWN0OiB7IHR5cGU6IFwidHJhbnNmb3JtXCIsIHRyYW5zZm9ybSB9LFxuICAgICAgICB9KTtcbiAgICB9XG4gICAgZGVmYXVsdChkZWYpIHtcbiAgICAgICAgY29uc3QgZGVmYXVsdFZhbHVlRnVuYyA9IHR5cGVvZiBkZWYgPT09IFwiZnVuY3Rpb25cIiA/IGRlZiA6ICgpID0+IGRlZjtcbiAgICAgICAgcmV0dXJuIG5ldyBab2REZWZhdWx0KHtcbiAgICAgICAgICAgIC4uLnByb2Nlc3NDcmVhdGVQYXJhbXModGhpcy5fZGVmKSxcbiAgICAgICAgICAgIGlubmVyVHlwZTogdGhpcyxcbiAgICAgICAgICAgIGRlZmF1bHRWYWx1ZTogZGVmYXVsdFZhbHVlRnVuYyxcbiAgICAgICAgICAgIHR5cGVOYW1lOiBab2RGaXJzdFBhcnR5VHlwZUtpbmQuWm9kRGVmYXVsdCxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIGJyYW5kKCkge1xuICAgICAgICByZXR1cm4gbmV3IFpvZEJyYW5kZWQoe1xuICAgICAgICAgICAgdHlwZU5hbWU6IFpvZEZpcnN0UGFydHlUeXBlS2luZC5ab2RCcmFuZGVkLFxuICAgICAgICAgICAgdHlwZTogdGhpcyxcbiAgICAgICAgICAgIC4uLnByb2Nlc3NDcmVhdGVQYXJhbXModGhpcy5fZGVmKSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIGNhdGNoKGRlZikge1xuICAgICAgICBjb25zdCBjYXRjaFZhbHVlRnVuYyA9IHR5cGVvZiBkZWYgPT09IFwiZnVuY3Rpb25cIiA/IGRlZiA6ICgpID0+IGRlZjtcbiAgICAgICAgcmV0dXJuIG5ldyBab2RDYXRjaCh7XG4gICAgICAgICAgICAuLi5wcm9jZXNzQ3JlYXRlUGFyYW1zKHRoaXMuX2RlZiksXG4gICAgICAgICAgICBpbm5lclR5cGU6IHRoaXMsXG4gICAgICAgICAgICBjYXRjaFZhbHVlOiBjYXRjaFZhbHVlRnVuYyxcbiAgICAgICAgICAgIHR5cGVOYW1lOiBab2RGaXJzdFBhcnR5VHlwZUtpbmQuWm9kQ2F0Y2gsXG4gICAgICAgIH0pO1xuICAgIH1cbiAgICBkZXNjcmliZShkZXNjcmlwdGlvbikge1xuICAgICAgICBjb25zdCBUaGlzID0gdGhpcy5jb25zdHJ1Y3RvcjtcbiAgICAgICAgcmV0dXJuIG5ldyBUaGlzKHtcbiAgICAgICAgICAgIC4uLnRoaXMuX2RlZixcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uLFxuICAgICAgICB9KTtcbiAgICB9XG4gICAgcGlwZSh0YXJnZXQpIHtcbiAgICAgICAgcmV0dXJuIFpvZFBpcGVsaW5lLmNyZWF0ZSh0aGlzLCB0YXJnZXQpO1xuICAgIH1cbiAgICByZWFkb25seSgpIHtcbiAgICAgICAgcmV0dXJuIFpvZFJlYWRvbmx5LmNyZWF0ZSh0aGlzKTtcbiAgICB9XG4gICAgaXNPcHRpb25hbCgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc2FmZVBhcnNlKHVuZGVmaW5lZCkuc3VjY2VzcztcbiAgICB9XG4gICAgaXNOdWxsYWJsZSgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc2FmZVBhcnNlKG51bGwpLnN1Y2Nlc3M7XG4gICAgfVxufVxuY29uc3QgY3VpZFJlZ2V4ID0gL15jW15cXHMtXXs4LH0kL2k7XG5jb25zdCBjdWlkMlJlZ2V4ID0gL15bMC05YS16XSskLztcbmNvbnN0IHVsaWRSZWdleCA9IC9eWzAtOUEtSEpLTU5QLVRWLVpdezI2fSQvaTtcbi8vIGNvbnN0IHV1aWRSZWdleCA9XG4vLyAgIC9eKFthLWYwLTldezh9LVthLWYwLTldezR9LVsxLTVdW2EtZjAtOV17M30tW2EtZjAtOV17NH0tW2EtZjAtOV17MTJ9fDAwMDAwMDAwLTAwMDAtMDAwMC0wMDAwLTAwMDAwMDAwMDAwMCkkL2k7XG5jb25zdCB1dWlkUmVnZXggPSAvXlswLTlhLWZBLUZdezh9XFxiLVswLTlhLWZBLUZdezR9XFxiLVswLTlhLWZBLUZdezR9XFxiLVswLTlhLWZBLUZdezR9XFxiLVswLTlhLWZBLUZdezEyfSQvaTtcbmNvbnN0IG5hbm9pZFJlZ2V4ID0gL15bYS16MC05Xy1dezIxfSQvaTtcbmNvbnN0IGp3dFJlZ2V4ID0gL15bQS1aYS16MC05LV9dK1xcLltBLVphLXowLTktX10rXFwuW0EtWmEtejAtOS1fXSokLztcbmNvbnN0IGR1cmF0aW9uUmVnZXggPSAvXlstK10/UCg/ISQpKD86KD86Wy0rXT9cXGQrWSl8KD86Wy0rXT9cXGQrWy4sXVxcZCtZJCkpPyg/Oig/OlstK10/XFxkK00pfCg/OlstK10/XFxkK1suLF1cXGQrTSQpKT8oPzooPzpbLStdP1xcZCtXKXwoPzpbLStdP1xcZCtbLixdXFxkK1ckKSk/KD86KD86Wy0rXT9cXGQrRCl8KD86Wy0rXT9cXGQrWy4sXVxcZCtEJCkpPyg/OlQoPz1bXFxkKy1dKSg/Oig/OlstK10/XFxkK0gpfCg/OlstK10/XFxkK1suLF1cXGQrSCQpKT8oPzooPzpbLStdP1xcZCtNKXwoPzpbLStdP1xcZCtbLixdXFxkK00kKSk/KD86Wy0rXT9cXGQrKD86Wy4sXVxcZCspP1MpPyk/PyQvO1xuLy8gZnJvbSBodHRwczovL3N0YWNrb3ZlcmZsb3cuY29tL2EvNDYxODEvMTU1MDE1NVxuLy8gb2xkIHZlcnNpb246IHRvbyBzbG93LCBkaWRuJ3Qgc3VwcG9ydCB1bmljb2RlXG4vLyBjb25zdCBlbWFpbFJlZ2V4ID0gL14oKChbYS16XXxcXGR8WyEjXFwkJSYnXFwqXFwrXFwtXFwvPVxcP1xcXl9ge1xcfH1+XXxbXFx1MDBBMC1cXHVEN0ZGXFx1RjkwMC1cXHVGRENGXFx1RkRGMC1cXHVGRkVGXSkrKFxcLihbYS16XXxcXGR8WyEjXFwkJSYnXFwqXFwrXFwtXFwvPVxcP1xcXl9ge1xcfH1+XXxbXFx1MDBBMC1cXHVEN0ZGXFx1RjkwMC1cXHVGRENGXFx1RkRGMC1cXHVGRkVGXSkrKSopfCgoXFx4MjIpKCgoKFxceDIwfFxceDA5KSooXFx4MGRcXHgwYSkpPyhcXHgyMHxcXHgwOSkrKT8oKFtcXHgwMS1cXHgwOFxceDBiXFx4MGNcXHgwZS1cXHgxZlxceDdmXXxcXHgyMXxbXFx4MjMtXFx4NWJdfFtcXHg1ZC1cXHg3ZV18W1xcdTAwQTAtXFx1RDdGRlxcdUY5MDAtXFx1RkRDRlxcdUZERjAtXFx1RkZFRl0pfChcXFxcKFtcXHgwMS1cXHgwOVxceDBiXFx4MGNcXHgwZC1cXHg3Zl18W1xcdTAwQTAtXFx1RDdGRlxcdUY5MDAtXFx1RkRDRlxcdUZERjAtXFx1RkZFRl0pKSkpKigoKFxceDIwfFxceDA5KSooXFx4MGRcXHgwYSkpPyhcXHgyMHxcXHgwOSkrKT8oXFx4MjIpKSlAKCgoW2Etel18XFxkfFtcXHUwMEEwLVxcdUQ3RkZcXHVGOTAwLVxcdUZEQ0ZcXHVGREYwLVxcdUZGRUZdKXwoKFthLXpdfFxcZHxbXFx1MDBBMC1cXHVEN0ZGXFx1RjkwMC1cXHVGRENGXFx1RkRGMC1cXHVGRkVGXSkoW2Etel18XFxkfC18XFwufF98fnxbXFx1MDBBMC1cXHVEN0ZGXFx1RjkwMC1cXHVGRENGXFx1RkRGMC1cXHVGRkVGXSkqKFthLXpdfFxcZHxbXFx1MDBBMC1cXHVEN0ZGXFx1RjkwMC1cXHVGRENGXFx1RkRGMC1cXHVGRkVGXSkpKVxcLikrKChbYS16XXxbXFx1MDBBMC1cXHVEN0ZGXFx1RjkwMC1cXHVGRENGXFx1RkRGMC1cXHVGRkVGXSl8KChbYS16XXxbXFx1MDBBMC1cXHVEN0ZGXFx1RjkwMC1cXHVGRENGXFx1RkRGMC1cXHVGRkVGXSkoW2Etel18XFxkfC18XFwufF98fnxbXFx1MDBBMC1cXHVEN0ZGXFx1RjkwMC1cXHVGRENGXFx1RkRGMC1cXHVGRkVGXSkqKFthLXpdfFtcXHUwMEEwLVxcdUQ3RkZcXHVGOTAwLVxcdUZEQ0ZcXHVGREYwLVxcdUZGRUZdKSkpJC9pO1xuLy9vbGQgZW1haWwgcmVnZXhcbi8vIGNvbnN0IGVtYWlsUmVnZXggPSAvXigoW148PigpW1xcXS4sOzpcXHNAXCJdKyhcXC5bXjw+KClbXFxdLiw7Olxcc0BcIl0rKSopfChcIi4rXCIpKUAoKD8hLSkoW148PigpW1xcXS4sOzpcXHNAXCJdK1xcLikrW148PigpW1xcXS4sOzpcXHNAXCJdezEsfSlbXi08PigpW1xcXS4sOzpcXHNAXCJdJC9pO1xuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lXG4vLyBjb25zdCBlbWFpbFJlZ2V4ID1cbi8vICAgL14oKFtePD4oKVtcXF1cXFxcLiw7Olxcc0BcXFwiXSsoXFwuW148PigpW1xcXVxcXFwuLDs6XFxzQFxcXCJdKykqKXwoXFxcIi4rXFxcIikpQCgoXFxbKCgoMjVbMC01XSl8KDJbMC00XVswLTldKXwoMVswLTldezJ9KXwoWzAtOV17MSwyfSkpXFwuKXszfSgoMjVbMC01XSl8KDJbMC00XVswLTldKXwoMVswLTldezJ9KXwoWzAtOV17MSwyfSkpXFxdKXwoXFxbSVB2NjooKFthLWYwLTldezEsNH06KXs3fXw6OihbYS1mMC05XXsxLDR9Oil7MCw2fXwoW2EtZjAtOV17MSw0fTopezF9OihbYS1mMC05XXsxLDR9Oil7MCw1fXwoW2EtZjAtOV17MSw0fTopezJ9OihbYS1mMC05XXsxLDR9Oil7MCw0fXwoW2EtZjAtOV17MSw0fTopezN9OihbYS1mMC05XXsxLDR9Oil7MCwzfXwoW2EtZjAtOV17MSw0fTopezR9OihbYS1mMC05XXsxLDR9Oil7MCwyfXwoW2EtZjAtOV17MSw0fTopezV9OihbYS1mMC05XXsxLDR9Oil7MCwxfSkoW2EtZjAtOV17MSw0fXwoKCgyNVswLTVdKXwoMlswLTRdWzAtOV0pfCgxWzAtOV17Mn0pfChbMC05XXsxLDJ9KSlcXC4pezN9KCgyNVswLTVdKXwoMlswLTRdWzAtOV0pfCgxWzAtOV17Mn0pfChbMC05XXsxLDJ9KSkpXFxdKXwoW0EtWmEtejAtOV0oW0EtWmEtejAtOS1dKltBLVphLXowLTldKSooXFwuW0EtWmEtel17Mix9KSspKSQvO1xuLy8gY29uc3QgZW1haWxSZWdleCA9XG4vLyAgIC9eW2EtekEtWjAtOVxcLlxcIVxcI1xcJFxcJVxcJlxcJ1xcKlxcK1xcL1xcPVxcP1xcXlxcX1xcYFxce1xcfFxcfVxcflxcLV0rQFthLXpBLVowLTldKD86W2EtekEtWjAtOS1dezAsNjF9W2EtekEtWjAtOV0pPyg/OlxcLlthLXpBLVowLTldKD86W2EtekEtWjAtOS1dezAsNjF9W2EtekEtWjAtOV0pPykqJC87XG4vLyBjb25zdCBlbWFpbFJlZ2V4ID1cbi8vICAgL14oPzpbYS16MC05ISMkJSYnKisvPT9eX2B7fH1+LV0rKD86XFwuW2EtejAtOSEjJCUmJyorLz0/Xl9ge3x9fi1dKykqfFwiKD86W1xceDAxLVxceDA4XFx4MGJcXHgwY1xceDBlLVxceDFmXFx4MjFcXHgyMy1cXHg1YlxceDVkLVxceDdmXXxcXFxcW1xceDAxLVxceDA5XFx4MGJcXHgwY1xceDBlLVxceDdmXSkqXCIpQCg/Oig/OlthLXowLTldKD86W2EtejAtOS1dKlthLXowLTldKT9cXC4pK1thLXowLTldKD86W2EtejAtOS1dKlthLXowLTldKT98XFxbKD86KD86MjVbMC01XXwyWzAtNF1bMC05XXxbMDFdP1swLTldWzAtOV0/KVxcLil7M30oPzoyNVswLTVdfDJbMC00XVswLTldfFswMV0/WzAtOV1bMC05XT98W2EtejAtOS1dKlthLXowLTldOig/OltcXHgwMS1cXHgwOFxceDBiXFx4MGNcXHgwZS1cXHgxZlxceDIxLVxceDVhXFx4NTMtXFx4N2ZdfFxcXFxbXFx4MDEtXFx4MDlcXHgwYlxceDBjXFx4MGUtXFx4N2ZdKSspXFxdKSQvaTtcbmNvbnN0IGVtYWlsUmVnZXggPSAvXig/IVxcLikoPyEuKlxcLlxcLikoW0EtWjAtOV8nK1xcLVxcLl0qKVtBLVowLTlfKy1dQChbQS1aMC05XVtBLVowLTlcXC1dKlxcLikrW0EtWl17Mix9JC9pO1xuLy8gY29uc3QgZW1haWxSZWdleCA9XG4vLyAgIC9eW2EtejAtOS4hIyQlJuKAmSorLz0/Xl9ge3x9fi1dK0BbYS16MC05LV0rKD86XFwuW2EtejAtOVxcLV0rKSokL2k7XG4vLyBmcm9tIGh0dHBzOi8vdGhla2V2aW5zY290dC5jb20vZW1vamlzLWluLWphdmFzY3JpcHQvI3dyaXRpbmctYS1yZWd1bGFyLWV4cHJlc3Npb25cbmNvbnN0IF9lbW9qaVJlZ2V4ID0gYF4oXFxcXHB7RXh0ZW5kZWRfUGljdG9ncmFwaGljfXxcXFxccHtFbW9qaV9Db21wb25lbnR9KSskYDtcbmxldCBlbW9qaVJlZ2V4O1xuLy8gZmFzdGVyLCBzaW1wbGVyLCBzYWZlclxuY29uc3QgaXB2NFJlZ2V4ID0gL14oPzooPzoyNVswLTVdfDJbMC00XVswLTldfDFbMC05XVswLTldfFsxLTldWzAtOV18WzAtOV0pXFwuKXszfSg/OjI1WzAtNV18MlswLTRdWzAtOV18MVswLTldWzAtOV18WzEtOV1bMC05XXxbMC05XSkkLztcbmNvbnN0IGlwdjRDaWRyUmVnZXggPSAvXig/Oig/OjI1WzAtNV18MlswLTRdWzAtOV18MVswLTldWzAtOV18WzEtOV1bMC05XXxbMC05XSlcXC4pezN9KD86MjVbMC01XXwyWzAtNF1bMC05XXwxWzAtOV1bMC05XXxbMS05XVswLTldfFswLTldKVxcLygzWzAtMl18WzEyXT9bMC05XSkkLztcbi8vIGNvbnN0IGlwdjZSZWdleCA9XG4vLyAvXigoW2EtZjAtOV17MSw0fTopezd9fDo6KFthLWYwLTldezEsNH06KXswLDZ9fChbYS1mMC05XXsxLDR9Oil7MX06KFthLWYwLTldezEsNH06KXswLDV9fChbYS1mMC05XXsxLDR9Oil7Mn06KFthLWYwLTldezEsNH06KXswLDR9fChbYS1mMC05XXsxLDR9Oil7M306KFthLWYwLTldezEsNH06KXswLDN9fChbYS1mMC05XXsxLDR9Oil7NH06KFthLWYwLTldezEsNH06KXswLDJ9fChbYS1mMC05XXsxLDR9Oil7NX06KFthLWYwLTldezEsNH06KXswLDF9KShbYS1mMC05XXsxLDR9fCgoKDI1WzAtNV0pfCgyWzAtNF1bMC05XSl8KDFbMC05XXsyfSl8KFswLTldezEsMn0pKVxcLil7M30oKDI1WzAtNV0pfCgyWzAtNF1bMC05XSl8KDFbMC05XXsyfSl8KFswLTldezEsMn0pKSkkLztcbmNvbnN0IGlwdjZSZWdleCA9IC9eKChbMC05YS1mQS1GXXsxLDR9Oil7Nyw3fVswLTlhLWZBLUZdezEsNH18KFswLTlhLWZBLUZdezEsNH06KXsxLDd9OnwoWzAtOWEtZkEtRl17MSw0fTopezEsNn06WzAtOWEtZkEtRl17MSw0fXwoWzAtOWEtZkEtRl17MSw0fTopezEsNX0oOlswLTlhLWZBLUZdezEsNH0pezEsMn18KFswLTlhLWZBLUZdezEsNH06KXsxLDR9KDpbMC05YS1mQS1GXXsxLDR9KXsxLDN9fChbMC05YS1mQS1GXXsxLDR9Oil7MSwzfSg6WzAtOWEtZkEtRl17MSw0fSl7MSw0fXwoWzAtOWEtZkEtRl17MSw0fTopezEsMn0oOlswLTlhLWZBLUZdezEsNH0pezEsNX18WzAtOWEtZkEtRl17MSw0fTooKDpbMC05YS1mQS1GXXsxLDR9KXsxLDZ9KXw6KCg6WzAtOWEtZkEtRl17MSw0fSl7MSw3fXw6KXxmZTgwOig6WzAtOWEtZkEtRl17MCw0fSl7MCw0fSVbMC05YS16QS1aXXsxLH18OjooZmZmZig6MHsxLDR9KXswLDF9Oil7MCwxfSgoMjVbMC01XXwoMlswLTRdfDF7MCwxfVswLTldKXswLDF9WzAtOV0pXFwuKXszLDN9KDI1WzAtNV18KDJbMC00XXwxezAsMX1bMC05XSl7MCwxfVswLTldKXwoWzAtOWEtZkEtRl17MSw0fTopezEsNH06KCgyNVswLTVdfCgyWzAtNF18MXswLDF9WzAtOV0pezAsMX1bMC05XSlcXC4pezMsM30oMjVbMC01XXwoMlswLTRdfDF7MCwxfVswLTldKXswLDF9WzAtOV0pKSQvO1xuY29uc3QgaXB2NkNpZHJSZWdleCA9IC9eKChbMC05YS1mQS1GXXsxLDR9Oil7Nyw3fVswLTlhLWZBLUZdezEsNH18KFswLTlhLWZBLUZdezEsNH06KXsxLDd9OnwoWzAtOWEtZkEtRl17MSw0fTopezEsNn06WzAtOWEtZkEtRl17MSw0fXwoWzAtOWEtZkEtRl17MSw0fTopezEsNX0oOlswLTlhLWZBLUZdezEsNH0pezEsMn18KFswLTlhLWZBLUZdezEsNH06KXsxLDR9KDpbMC05YS1mQS1GXXsxLDR9KXsxLDN9fChbMC05YS1mQS1GXXsxLDR9Oil7MSwzfSg6WzAtOWEtZkEtRl17MSw0fSl7MSw0fXwoWzAtOWEtZkEtRl17MSw0fTopezEsMn0oOlswLTlhLWZBLUZdezEsNH0pezEsNX18WzAtOWEtZkEtRl17MSw0fTooKDpbMC05YS1mQS1GXXsxLDR9KXsxLDZ9KXw6KCg6WzAtOWEtZkEtRl17MSw0fSl7MSw3fXw6KXxmZTgwOig6WzAtOWEtZkEtRl17MCw0fSl7MCw0fSVbMC05YS16QS1aXXsxLH18OjooZmZmZig6MHsxLDR9KXswLDF9Oil7MCwxfSgoMjVbMC01XXwoMlswLTRdfDF7MCwxfVswLTldKXswLDF9WzAtOV0pXFwuKXszLDN9KDI1WzAtNV18KDJbMC00XXwxezAsMX1bMC05XSl7MCwxfVswLTldKXwoWzAtOWEtZkEtRl17MSw0fTopezEsNH06KCgyNVswLTVdfCgyWzAtNF18MXswLDF9WzAtOV0pezAsMX1bMC05XSlcXC4pezMsM30oMjVbMC01XXwoMlswLTRdfDF7MCwxfVswLTldKXswLDF9WzAtOV0pKVxcLygxMlswLThdfDFbMDFdWzAtOV18WzEtOV0/WzAtOV0pJC87XG4vLyBodHRwczovL3N0YWNrb3ZlcmZsb3cuY29tL3F1ZXN0aW9ucy83ODYwMzkyL2RldGVybWluZS1pZi1zdHJpbmctaXMtaW4tYmFzZTY0LXVzaW5nLWphdmFzY3JpcHRcbmNvbnN0IGJhc2U2NFJlZ2V4ID0gL14oWzAtOWEtekEtWisvXXs0fSkqKChbMC05YS16QS1aKy9dezJ9PT0pfChbMC05YS16QS1aKy9dezN9PSkpPyQvO1xuLy8gaHR0cHM6Ly9iYXNlNjQuZ3VydS9zdGFuZGFyZHMvYmFzZTY0dXJsXG5jb25zdCBiYXNlNjR1cmxSZWdleCA9IC9eKFswLTlhLXpBLVotX117NH0pKigoWzAtOWEtekEtWi1fXXsyfSg9PSk/KXwoWzAtOWEtekEtWi1fXXszfSg9KT8pKT8kLztcbi8vIHNpbXBsZVxuLy8gY29uc3QgZGF0ZVJlZ2V4U291cmNlID0gYFxcXFxkezR9LVxcXFxkezJ9LVxcXFxkezJ9YDtcbi8vIG5vIGxlYXAgeWVhciB2YWxpZGF0aW9uXG4vLyBjb25zdCBkYXRlUmVnZXhTb3VyY2UgPSBgXFxcXGR7NH0tKCgwWzEzNTc4XXwxMHwxMiktMzF8KDBbMTMtOV18MVswLTJdKS0zMHwoMFsxLTldfDFbMC0yXSktKDBbMS05XXwxXFxcXGR8MlxcXFxkKSlgO1xuLy8gd2l0aCBsZWFwIHllYXIgdmFsaWRhdGlvblxuY29uc3QgZGF0ZVJlZ2V4U291cmNlID0gYCgoXFxcXGRcXFxcZFsyNDY4XVswNDhdfFxcXFxkXFxcXGRbMTM1NzldWzI2XXxcXFxcZFxcXFxkMFs0OF18WzAyNDY4XVswNDhdMDB8WzEzNTc5XVsyNl0wMCktMDItMjl8XFxcXGR7NH0tKCgwWzEzNTc4XXwxWzAyXSktKDBbMS05XXxbMTJdXFxcXGR8M1swMV0pfCgwWzQ2OV18MTEpLSgwWzEtOV18WzEyXVxcXFxkfDMwKXwoMDIpLSgwWzEtOV18MVxcXFxkfDJbMC04XSkpKWA7XG5jb25zdCBkYXRlUmVnZXggPSBuZXcgUmVnRXhwKGBeJHtkYXRlUmVnZXhTb3VyY2V9JGApO1xuZnVuY3Rpb24gdGltZVJlZ2V4U291cmNlKGFyZ3MpIHtcbiAgICBsZXQgc2Vjb25kc1JlZ2V4U291cmNlID0gYFswLTVdXFxcXGRgO1xuICAgIGlmIChhcmdzLnByZWNpc2lvbikge1xuICAgICAgICBzZWNvbmRzUmVnZXhTb3VyY2UgPSBgJHtzZWNvbmRzUmVnZXhTb3VyY2V9XFxcXC5cXFxcZHske2FyZ3MucHJlY2lzaW9ufX1gO1xuICAgIH1cbiAgICBlbHNlIGlmIChhcmdzLnByZWNpc2lvbiA9PSBudWxsKSB7XG4gICAgICAgIHNlY29uZHNSZWdleFNvdXJjZSA9IGAke3NlY29uZHNSZWdleFNvdXJjZX0oXFxcXC5cXFxcZCspP2A7XG4gICAgfVxuICAgIGNvbnN0IHNlY29uZHNRdWFudGlmaWVyID0gYXJncy5wcmVjaXNpb24gPyBcIitcIiA6IFwiP1wiOyAvLyByZXF1aXJlIHNlY29uZHMgaWYgcHJlY2lzaW9uIGlzIG5vbnplcm9cbiAgICByZXR1cm4gYChbMDFdXFxcXGR8MlswLTNdKTpbMC01XVxcXFxkKDoke3NlY29uZHNSZWdleFNvdXJjZX0pJHtzZWNvbmRzUXVhbnRpZmllcn1gO1xufVxuZnVuY3Rpb24gdGltZVJlZ2V4KGFyZ3MpIHtcbiAgICByZXR1cm4gbmV3IFJlZ0V4cChgXiR7dGltZVJlZ2V4U291cmNlKGFyZ3MpfSRgKTtcbn1cbi8vIEFkYXB0ZWQgZnJvbSBodHRwczovL3N0YWNrb3ZlcmZsb3cuY29tL2EvMzE0MzIzMVxuZXhwb3J0IGZ1bmN0aW9uIGRhdGV0aW1lUmVnZXgoYXJncykge1xuICAgIGxldCByZWdleCA9IGAke2RhdGVSZWdleFNvdXJjZX1UJHt0aW1lUmVnZXhTb3VyY2UoYXJncyl9YDtcbiAgICBjb25zdCBvcHRzID0gW107XG4gICAgb3B0cy5wdXNoKGFyZ3MubG9jYWwgPyBgWj9gIDogYFpgKTtcbiAgICBpZiAoYXJncy5vZmZzZXQpXG4gICAgICAgIG9wdHMucHVzaChgKFsrLV1cXFxcZHsyfTo/XFxcXGR7Mn0pYCk7XG4gICAgcmVnZXggPSBgJHtyZWdleH0oJHtvcHRzLmpvaW4oXCJ8XCIpfSlgO1xuICAgIHJldHVybiBuZXcgUmVnRXhwKGBeJHtyZWdleH0kYCk7XG59XG5mdW5jdGlvbiBpc1ZhbGlkSVAoaXAsIHZlcnNpb24pIHtcbiAgICBpZiAoKHZlcnNpb24gPT09IFwidjRcIiB8fCAhdmVyc2lvbikgJiYgaXB2NFJlZ2V4LnRlc3QoaXApKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICBpZiAoKHZlcnNpb24gPT09IFwidjZcIiB8fCAhdmVyc2lvbikgJiYgaXB2NlJlZ2V4LnRlc3QoaXApKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG59XG5mdW5jdGlvbiBpc1ZhbGlkSldUKGp3dCwgYWxnKSB7XG4gICAgaWYgKCFqd3RSZWdleC50ZXN0KGp3dCkpXG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB0cnkge1xuICAgICAgICBjb25zdCBbaGVhZGVyXSA9IGp3dC5zcGxpdChcIi5cIik7XG4gICAgICAgIC8vIENvbnZlcnQgYmFzZTY0dXJsIHRvIGJhc2U2NFxuICAgICAgICBjb25zdCBiYXNlNjQgPSBoZWFkZXJcbiAgICAgICAgICAgIC5yZXBsYWNlKC8tL2csIFwiK1wiKVxuICAgICAgICAgICAgLnJlcGxhY2UoL18vZywgXCIvXCIpXG4gICAgICAgICAgICAucGFkRW5kKGhlYWRlci5sZW5ndGggKyAoKDQgLSAoaGVhZGVyLmxlbmd0aCAlIDQpKSAlIDQpLCBcIj1cIik7XG4gICAgICAgIGNvbnN0IGRlY29kZWQgPSBKU09OLnBhcnNlKGF0b2IoYmFzZTY0KSk7XG4gICAgICAgIGlmICh0eXBlb2YgZGVjb2RlZCAhPT0gXCJvYmplY3RcIiB8fCBkZWNvZGVkID09PSBudWxsKVxuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICBpZiAoXCJ0eXBcIiBpbiBkZWNvZGVkICYmIGRlY29kZWQ/LnR5cCAhPT0gXCJKV1RcIilcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgaWYgKCFkZWNvZGVkLmFsZylcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgaWYgKGFsZyAmJiBkZWNvZGVkLmFsZyAhPT0gYWxnKVxuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgY2F0Y2gge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxufVxuZnVuY3Rpb24gaXNWYWxpZENpZHIoaXAsIHZlcnNpb24pIHtcbiAgICBpZiAoKHZlcnNpb24gPT09IFwidjRcIiB8fCAhdmVyc2lvbikgJiYgaXB2NENpZHJSZWdleC50ZXN0KGlwKSkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgaWYgKCh2ZXJzaW9uID09PSBcInY2XCIgfHwgIXZlcnNpb24pICYmIGlwdjZDaWRyUmVnZXgudGVzdChpcCkpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbn1cbmV4cG9ydCBjbGFzcyBab2RTdHJpbmcgZXh0ZW5kcyBab2RUeXBlIHtcbiAgICBfcGFyc2UoaW5wdXQpIHtcbiAgICAgICAgaWYgKHRoaXMuX2RlZi5jb2VyY2UpIHtcbiAgICAgICAgICAgIGlucHV0LmRhdGEgPSBTdHJpbmcoaW5wdXQuZGF0YSk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcGFyc2VkVHlwZSA9IHRoaXMuX2dldFR5cGUoaW5wdXQpO1xuICAgICAgICBpZiAocGFyc2VkVHlwZSAhPT0gWm9kUGFyc2VkVHlwZS5zdHJpbmcpIHtcbiAgICAgICAgICAgIGNvbnN0IGN0eCA9IHRoaXMuX2dldE9yUmV0dXJuQ3R4KGlucHV0KTtcbiAgICAgICAgICAgIGFkZElzc3VlVG9Db250ZXh0KGN0eCwge1xuICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS5pbnZhbGlkX3R5cGUsXG4gICAgICAgICAgICAgICAgZXhwZWN0ZWQ6IFpvZFBhcnNlZFR5cGUuc3RyaW5nLFxuICAgICAgICAgICAgICAgIHJlY2VpdmVkOiBjdHgucGFyc2VkVHlwZSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIElOVkFMSUQ7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgc3RhdHVzID0gbmV3IFBhcnNlU3RhdHVzKCk7XG4gICAgICAgIGxldCBjdHggPSB1bmRlZmluZWQ7XG4gICAgICAgIGZvciAoY29uc3QgY2hlY2sgb2YgdGhpcy5fZGVmLmNoZWNrcykge1xuICAgICAgICAgICAgaWYgKGNoZWNrLmtpbmQgPT09IFwibWluXCIpIHtcbiAgICAgICAgICAgICAgICBpZiAoaW5wdXQuZGF0YS5sZW5ndGggPCBjaGVjay52YWx1ZSkge1xuICAgICAgICAgICAgICAgICAgICBjdHggPSB0aGlzLl9nZXRPclJldHVybkN0eChpbnB1dCwgY3R4KTtcbiAgICAgICAgICAgICAgICAgICAgYWRkSXNzdWVUb0NvbnRleHQoY3R4LCB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb2RlOiBab2RJc3N1ZUNvZGUudG9vX3NtYWxsLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWluaW11bTogY2hlY2sudmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiBcInN0cmluZ1wiLFxuICAgICAgICAgICAgICAgICAgICAgICAgaW5jbHVzaXZlOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgZXhhY3Q6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogY2hlY2subWVzc2FnZSxcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIHN0YXR1cy5kaXJ0eSgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKGNoZWNrLmtpbmQgPT09IFwibWF4XCIpIHtcbiAgICAgICAgICAgICAgICBpZiAoaW5wdXQuZGF0YS5sZW5ndGggPiBjaGVjay52YWx1ZSkge1xuICAgICAgICAgICAgICAgICAgICBjdHggPSB0aGlzLl9nZXRPclJldHVybkN0eChpbnB1dCwgY3R4KTtcbiAgICAgICAgICAgICAgICAgICAgYWRkSXNzdWVUb0NvbnRleHQoY3R4LCB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb2RlOiBab2RJc3N1ZUNvZGUudG9vX2JpZyxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1heGltdW06IGNoZWNrLnZhbHVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJzdHJpbmdcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIGluY2x1c2l2ZTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGV4YWN0OiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGNoZWNrLm1lc3NhZ2UsXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICBzdGF0dXMuZGlydHkoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChjaGVjay5raW5kID09PSBcImxlbmd0aFwiKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdG9vQmlnID0gaW5wdXQuZGF0YS5sZW5ndGggPiBjaGVjay52YWx1ZTtcbiAgICAgICAgICAgICAgICBjb25zdCB0b29TbWFsbCA9IGlucHV0LmRhdGEubGVuZ3RoIDwgY2hlY2sudmFsdWU7XG4gICAgICAgICAgICAgICAgaWYgKHRvb0JpZyB8fCB0b29TbWFsbCkge1xuICAgICAgICAgICAgICAgICAgICBjdHggPSB0aGlzLl9nZXRPclJldHVybkN0eChpbnB1dCwgY3R4KTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRvb0JpZykge1xuICAgICAgICAgICAgICAgICAgICAgICAgYWRkSXNzdWVUb0NvbnRleHQoY3R4LCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLnRvb19iaWcsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWF4aW11bTogY2hlY2sudmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJzdHJpbmdcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmNsdXNpdmU6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogY2hlY2subWVzc2FnZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKHRvb1NtYWxsKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb2RlOiBab2RJc3N1ZUNvZGUudG9vX3NtYWxsLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1pbmltdW06IGNoZWNrLnZhbHVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6IFwic3RyaW5nXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5jbHVzaXZlOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGNoZWNrLm1lc3NhZ2UsXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBzdGF0dXMuZGlydHkoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChjaGVjay5raW5kID09PSBcImVtYWlsXCIpIHtcbiAgICAgICAgICAgICAgICBpZiAoIWVtYWlsUmVnZXgudGVzdChpbnB1dC5kYXRhKSkge1xuICAgICAgICAgICAgICAgICAgICBjdHggPSB0aGlzLl9nZXRPclJldHVybkN0eChpbnB1dCwgY3R4KTtcbiAgICAgICAgICAgICAgICAgICAgYWRkSXNzdWVUb0NvbnRleHQoY3R4LCB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWxpZGF0aW9uOiBcImVtYWlsXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2RlOiBab2RJc3N1ZUNvZGUuaW52YWxpZF9zdHJpbmcsXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBjaGVjay5tZXNzYWdlLFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzLmRpcnR5KCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAoY2hlY2sua2luZCA9PT0gXCJlbW9qaVwiKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFlbW9qaVJlZ2V4KSB7XG4gICAgICAgICAgICAgICAgICAgIGVtb2ppUmVnZXggPSBuZXcgUmVnRXhwKF9lbW9qaVJlZ2V4LCBcInVcIik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICghZW1vamlSZWdleC50ZXN0KGlucHV0LmRhdGEpKSB7XG4gICAgICAgICAgICAgICAgICAgIGN0eCA9IHRoaXMuX2dldE9yUmV0dXJuQ3R4KGlucHV0LCBjdHgpO1xuICAgICAgICAgICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlkYXRpb246IFwiZW1vamlcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS5pbnZhbGlkX3N0cmluZyxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGNoZWNrLm1lc3NhZ2UsXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICBzdGF0dXMuZGlydHkoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChjaGVjay5raW5kID09PSBcInV1aWRcIikge1xuICAgICAgICAgICAgICAgIGlmICghdXVpZFJlZ2V4LnRlc3QoaW5wdXQuZGF0YSkpIHtcbiAgICAgICAgICAgICAgICAgICAgY3R4ID0gdGhpcy5fZ2V0T3JSZXR1cm5DdHgoaW5wdXQsIGN0eCk7XG4gICAgICAgICAgICAgICAgICAgIGFkZElzc3VlVG9Db250ZXh0KGN0eCwge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWRhdGlvbjogXCJ1dWlkXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2RlOiBab2RJc3N1ZUNvZGUuaW52YWxpZF9zdHJpbmcsXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBjaGVjay5tZXNzYWdlLFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzLmRpcnR5KCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAoY2hlY2sua2luZCA9PT0gXCJuYW5vaWRcIikge1xuICAgICAgICAgICAgICAgIGlmICghbmFub2lkUmVnZXgudGVzdChpbnB1dC5kYXRhKSkge1xuICAgICAgICAgICAgICAgICAgICBjdHggPSB0aGlzLl9nZXRPclJldHVybkN0eChpbnB1dCwgY3R4KTtcbiAgICAgICAgICAgICAgICAgICAgYWRkSXNzdWVUb0NvbnRleHQoY3R4LCB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWxpZGF0aW9uOiBcIm5hbm9pZFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLmludmFsaWRfc3RyaW5nLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogY2hlY2subWVzc2FnZSxcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIHN0YXR1cy5kaXJ0eSgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKGNoZWNrLmtpbmQgPT09IFwiY3VpZFwiKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFjdWlkUmVnZXgudGVzdChpbnB1dC5kYXRhKSkge1xuICAgICAgICAgICAgICAgICAgICBjdHggPSB0aGlzLl9nZXRPclJldHVybkN0eChpbnB1dCwgY3R4KTtcbiAgICAgICAgICAgICAgICAgICAgYWRkSXNzdWVUb0NvbnRleHQoY3R4LCB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWxpZGF0aW9uOiBcImN1aWRcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS5pbnZhbGlkX3N0cmluZyxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGNoZWNrLm1lc3NhZ2UsXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICBzdGF0dXMuZGlydHkoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChjaGVjay5raW5kID09PSBcImN1aWQyXCIpIHtcbiAgICAgICAgICAgICAgICBpZiAoIWN1aWQyUmVnZXgudGVzdChpbnB1dC5kYXRhKSkge1xuICAgICAgICAgICAgICAgICAgICBjdHggPSB0aGlzLl9nZXRPclJldHVybkN0eChpbnB1dCwgY3R4KTtcbiAgICAgICAgICAgICAgICAgICAgYWRkSXNzdWVUb0NvbnRleHQoY3R4LCB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWxpZGF0aW9uOiBcImN1aWQyXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2RlOiBab2RJc3N1ZUNvZGUuaW52YWxpZF9zdHJpbmcsXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBjaGVjay5tZXNzYWdlLFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzLmRpcnR5KCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAoY2hlY2sua2luZCA9PT0gXCJ1bGlkXCIpIHtcbiAgICAgICAgICAgICAgICBpZiAoIXVsaWRSZWdleC50ZXN0KGlucHV0LmRhdGEpKSB7XG4gICAgICAgICAgICAgICAgICAgIGN0eCA9IHRoaXMuX2dldE9yUmV0dXJuQ3R4KGlucHV0LCBjdHgpO1xuICAgICAgICAgICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlkYXRpb246IFwidWxpZFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLmludmFsaWRfc3RyaW5nLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogY2hlY2subWVzc2FnZSxcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIHN0YXR1cy5kaXJ0eSgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKGNoZWNrLmtpbmQgPT09IFwidXJsXCIpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBuZXcgVVJMKGlucHV0LmRhdGEpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjYXRjaCB7XG4gICAgICAgICAgICAgICAgICAgIGN0eCA9IHRoaXMuX2dldE9yUmV0dXJuQ3R4KGlucHV0LCBjdHgpO1xuICAgICAgICAgICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlkYXRpb246IFwidXJsXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2RlOiBab2RJc3N1ZUNvZGUuaW52YWxpZF9zdHJpbmcsXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBjaGVjay5tZXNzYWdlLFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzLmRpcnR5KCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAoY2hlY2sua2luZCA9PT0gXCJyZWdleFwiKSB7XG4gICAgICAgICAgICAgICAgY2hlY2sucmVnZXgubGFzdEluZGV4ID0gMDtcbiAgICAgICAgICAgICAgICBjb25zdCB0ZXN0UmVzdWx0ID0gY2hlY2sucmVnZXgudGVzdChpbnB1dC5kYXRhKTtcbiAgICAgICAgICAgICAgICBpZiAoIXRlc3RSZXN1bHQpIHtcbiAgICAgICAgICAgICAgICAgICAgY3R4ID0gdGhpcy5fZ2V0T3JSZXR1cm5DdHgoaW5wdXQsIGN0eCk7XG4gICAgICAgICAgICAgICAgICAgIGFkZElzc3VlVG9Db250ZXh0KGN0eCwge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWRhdGlvbjogXCJyZWdleFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLmludmFsaWRfc3RyaW5nLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogY2hlY2subWVzc2FnZSxcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIHN0YXR1cy5kaXJ0eSgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKGNoZWNrLmtpbmQgPT09IFwidHJpbVwiKSB7XG4gICAgICAgICAgICAgICAgaW5wdXQuZGF0YSA9IGlucHV0LmRhdGEudHJpbSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAoY2hlY2sua2luZCA9PT0gXCJpbmNsdWRlc1wiKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFpbnB1dC5kYXRhLmluY2x1ZGVzKGNoZWNrLnZhbHVlLCBjaGVjay5wb3NpdGlvbikpIHtcbiAgICAgICAgICAgICAgICAgICAgY3R4ID0gdGhpcy5fZ2V0T3JSZXR1cm5DdHgoaW5wdXQsIGN0eCk7XG4gICAgICAgICAgICAgICAgICAgIGFkZElzc3VlVG9Db250ZXh0KGN0eCwge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLmludmFsaWRfc3RyaW5nLFxuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWRhdGlvbjogeyBpbmNsdWRlczogY2hlY2sudmFsdWUsIHBvc2l0aW9uOiBjaGVjay5wb3NpdGlvbiB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogY2hlY2subWVzc2FnZSxcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIHN0YXR1cy5kaXJ0eSgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKGNoZWNrLmtpbmQgPT09IFwidG9Mb3dlckNhc2VcIikge1xuICAgICAgICAgICAgICAgIGlucHV0LmRhdGEgPSBpbnB1dC5kYXRhLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChjaGVjay5raW5kID09PSBcInRvVXBwZXJDYXNlXCIpIHtcbiAgICAgICAgICAgICAgICBpbnB1dC5kYXRhID0gaW5wdXQuZGF0YS50b1VwcGVyQ2FzZSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAoY2hlY2sua2luZCA9PT0gXCJzdGFydHNXaXRoXCIpIHtcbiAgICAgICAgICAgICAgICBpZiAoIWlucHV0LmRhdGEuc3RhcnRzV2l0aChjaGVjay52YWx1ZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgY3R4ID0gdGhpcy5fZ2V0T3JSZXR1cm5DdHgoaW5wdXQsIGN0eCk7XG4gICAgICAgICAgICAgICAgICAgIGFkZElzc3VlVG9Db250ZXh0KGN0eCwge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLmludmFsaWRfc3RyaW5nLFxuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWRhdGlvbjogeyBzdGFydHNXaXRoOiBjaGVjay52YWx1ZSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogY2hlY2subWVzc2FnZSxcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIHN0YXR1cy5kaXJ0eSgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKGNoZWNrLmtpbmQgPT09IFwiZW5kc1dpdGhcIikge1xuICAgICAgICAgICAgICAgIGlmICghaW5wdXQuZGF0YS5lbmRzV2l0aChjaGVjay52YWx1ZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgY3R4ID0gdGhpcy5fZ2V0T3JSZXR1cm5DdHgoaW5wdXQsIGN0eCk7XG4gICAgICAgICAgICAgICAgICAgIGFkZElzc3VlVG9Db250ZXh0KGN0eCwge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLmludmFsaWRfc3RyaW5nLFxuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWRhdGlvbjogeyBlbmRzV2l0aDogY2hlY2sudmFsdWUgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGNoZWNrLm1lc3NhZ2UsXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICBzdGF0dXMuZGlydHkoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChjaGVjay5raW5kID09PSBcImRhdGV0aW1lXCIpIHtcbiAgICAgICAgICAgICAgICBjb25zdCByZWdleCA9IGRhdGV0aW1lUmVnZXgoY2hlY2spO1xuICAgICAgICAgICAgICAgIGlmICghcmVnZXgudGVzdChpbnB1dC5kYXRhKSkge1xuICAgICAgICAgICAgICAgICAgICBjdHggPSB0aGlzLl9nZXRPclJldHVybkN0eChpbnB1dCwgY3R4KTtcbiAgICAgICAgICAgICAgICAgICAgYWRkSXNzdWVUb0NvbnRleHQoY3R4LCB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb2RlOiBab2RJc3N1ZUNvZGUuaW52YWxpZF9zdHJpbmcsXG4gICAgICAgICAgICAgICAgICAgICAgICB2YWxpZGF0aW9uOiBcImRhdGV0aW1lXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBjaGVjay5tZXNzYWdlLFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzLmRpcnR5KCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAoY2hlY2sua2luZCA9PT0gXCJkYXRlXCIpIHtcbiAgICAgICAgICAgICAgICBjb25zdCByZWdleCA9IGRhdGVSZWdleDtcbiAgICAgICAgICAgICAgICBpZiAoIXJlZ2V4LnRlc3QoaW5wdXQuZGF0YSkpIHtcbiAgICAgICAgICAgICAgICAgICAgY3R4ID0gdGhpcy5fZ2V0T3JSZXR1cm5DdHgoaW5wdXQsIGN0eCk7XG4gICAgICAgICAgICAgICAgICAgIGFkZElzc3VlVG9Db250ZXh0KGN0eCwge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLmludmFsaWRfc3RyaW5nLFxuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWRhdGlvbjogXCJkYXRlXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBjaGVjay5tZXNzYWdlLFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzLmRpcnR5KCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAoY2hlY2sua2luZCA9PT0gXCJ0aW1lXCIpIHtcbiAgICAgICAgICAgICAgICBjb25zdCByZWdleCA9IHRpbWVSZWdleChjaGVjayk7XG4gICAgICAgICAgICAgICAgaWYgKCFyZWdleC50ZXN0KGlucHV0LmRhdGEpKSB7XG4gICAgICAgICAgICAgICAgICAgIGN0eCA9IHRoaXMuX2dldE9yUmV0dXJuQ3R4KGlucHV0LCBjdHgpO1xuICAgICAgICAgICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS5pbnZhbGlkX3N0cmluZyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlkYXRpb246IFwidGltZVwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogY2hlY2subWVzc2FnZSxcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIHN0YXR1cy5kaXJ0eSgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKGNoZWNrLmtpbmQgPT09IFwiZHVyYXRpb25cIikge1xuICAgICAgICAgICAgICAgIGlmICghZHVyYXRpb25SZWdleC50ZXN0KGlucHV0LmRhdGEpKSB7XG4gICAgICAgICAgICAgICAgICAgIGN0eCA9IHRoaXMuX2dldE9yUmV0dXJuQ3R4KGlucHV0LCBjdHgpO1xuICAgICAgICAgICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlkYXRpb246IFwiZHVyYXRpb25cIixcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS5pbnZhbGlkX3N0cmluZyxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGNoZWNrLm1lc3NhZ2UsXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICBzdGF0dXMuZGlydHkoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChjaGVjay5raW5kID09PSBcImlwXCIpIHtcbiAgICAgICAgICAgICAgICBpZiAoIWlzVmFsaWRJUChpbnB1dC5kYXRhLCBjaGVjay52ZXJzaW9uKSkge1xuICAgICAgICAgICAgICAgICAgICBjdHggPSB0aGlzLl9nZXRPclJldHVybkN0eChpbnB1dCwgY3R4KTtcbiAgICAgICAgICAgICAgICAgICAgYWRkSXNzdWVUb0NvbnRleHQoY3R4LCB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWxpZGF0aW9uOiBcImlwXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2RlOiBab2RJc3N1ZUNvZGUuaW52YWxpZF9zdHJpbmcsXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBjaGVjay5tZXNzYWdlLFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzLmRpcnR5KCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAoY2hlY2sua2luZCA9PT0gXCJqd3RcIikge1xuICAgICAgICAgICAgICAgIGlmICghaXNWYWxpZEpXVChpbnB1dC5kYXRhLCBjaGVjay5hbGcpKSB7XG4gICAgICAgICAgICAgICAgICAgIGN0eCA9IHRoaXMuX2dldE9yUmV0dXJuQ3R4KGlucHV0LCBjdHgpO1xuICAgICAgICAgICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlkYXRpb246IFwiand0XCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2RlOiBab2RJc3N1ZUNvZGUuaW52YWxpZF9zdHJpbmcsXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBjaGVjay5tZXNzYWdlLFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzLmRpcnR5KCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAoY2hlY2sua2luZCA9PT0gXCJjaWRyXCIpIHtcbiAgICAgICAgICAgICAgICBpZiAoIWlzVmFsaWRDaWRyKGlucHV0LmRhdGEsIGNoZWNrLnZlcnNpb24pKSB7XG4gICAgICAgICAgICAgICAgICAgIGN0eCA9IHRoaXMuX2dldE9yUmV0dXJuQ3R4KGlucHV0LCBjdHgpO1xuICAgICAgICAgICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlkYXRpb246IFwiY2lkclwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLmludmFsaWRfc3RyaW5nLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogY2hlY2subWVzc2FnZSxcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIHN0YXR1cy5kaXJ0eSgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKGNoZWNrLmtpbmQgPT09IFwiYmFzZTY0XCIpIHtcbiAgICAgICAgICAgICAgICBpZiAoIWJhc2U2NFJlZ2V4LnRlc3QoaW5wdXQuZGF0YSkpIHtcbiAgICAgICAgICAgICAgICAgICAgY3R4ID0gdGhpcy5fZ2V0T3JSZXR1cm5DdHgoaW5wdXQsIGN0eCk7XG4gICAgICAgICAgICAgICAgICAgIGFkZElzc3VlVG9Db250ZXh0KGN0eCwge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWRhdGlvbjogXCJiYXNlNjRcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS5pbnZhbGlkX3N0cmluZyxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGNoZWNrLm1lc3NhZ2UsXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICBzdGF0dXMuZGlydHkoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChjaGVjay5raW5kID09PSBcImJhc2U2NHVybFwiKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFiYXNlNjR1cmxSZWdleC50ZXN0KGlucHV0LmRhdGEpKSB7XG4gICAgICAgICAgICAgICAgICAgIGN0eCA9IHRoaXMuX2dldE9yUmV0dXJuQ3R4KGlucHV0LCBjdHgpO1xuICAgICAgICAgICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlkYXRpb246IFwiYmFzZTY0dXJsXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2RlOiBab2RJc3N1ZUNvZGUuaW52YWxpZF9zdHJpbmcsXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBjaGVjay5tZXNzYWdlLFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzLmRpcnR5KCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgdXRpbC5hc3NlcnROZXZlcihjaGVjayk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHsgc3RhdHVzOiBzdGF0dXMudmFsdWUsIHZhbHVlOiBpbnB1dC5kYXRhIH07XG4gICAgfVxuICAgIF9yZWdleChyZWdleCwgdmFsaWRhdGlvbiwgbWVzc2FnZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5yZWZpbmVtZW50KChkYXRhKSA9PiByZWdleC50ZXN0KGRhdGEpLCB7XG4gICAgICAgICAgICB2YWxpZGF0aW9uLFxuICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLmludmFsaWRfc3RyaW5nLFxuICAgICAgICAgICAgLi4uZXJyb3JVdGlsLmVyclRvT2JqKG1lc3NhZ2UpLFxuICAgICAgICB9KTtcbiAgICB9XG4gICAgX2FkZENoZWNrKGNoZWNrKSB7XG4gICAgICAgIHJldHVybiBuZXcgWm9kU3RyaW5nKHtcbiAgICAgICAgICAgIC4uLnRoaXMuX2RlZixcbiAgICAgICAgICAgIGNoZWNrczogWy4uLnRoaXMuX2RlZi5jaGVja3MsIGNoZWNrXSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIGVtYWlsKG1lc3NhZ2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2FkZENoZWNrKHsga2luZDogXCJlbWFpbFwiLCAuLi5lcnJvclV0aWwuZXJyVG9PYmoobWVzc2FnZSkgfSk7XG4gICAgfVxuICAgIHVybChtZXNzYWdlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9hZGRDaGVjayh7IGtpbmQ6IFwidXJsXCIsIC4uLmVycm9yVXRpbC5lcnJUb09iaihtZXNzYWdlKSB9KTtcbiAgICB9XG4gICAgZW1vamkobWVzc2FnZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5fYWRkQ2hlY2soeyBraW5kOiBcImVtb2ppXCIsIC4uLmVycm9yVXRpbC5lcnJUb09iaihtZXNzYWdlKSB9KTtcbiAgICB9XG4gICAgdXVpZChtZXNzYWdlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9hZGRDaGVjayh7IGtpbmQ6IFwidXVpZFwiLCAuLi5lcnJvclV0aWwuZXJyVG9PYmoobWVzc2FnZSkgfSk7XG4gICAgfVxuICAgIG5hbm9pZChtZXNzYWdlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9hZGRDaGVjayh7IGtpbmQ6IFwibmFub2lkXCIsIC4uLmVycm9yVXRpbC5lcnJUb09iaihtZXNzYWdlKSB9KTtcbiAgICB9XG4gICAgY3VpZChtZXNzYWdlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9hZGRDaGVjayh7IGtpbmQ6IFwiY3VpZFwiLCAuLi5lcnJvclV0aWwuZXJyVG9PYmoobWVzc2FnZSkgfSk7XG4gICAgfVxuICAgIGN1aWQyKG1lc3NhZ2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2FkZENoZWNrKHsga2luZDogXCJjdWlkMlwiLCAuLi5lcnJvclV0aWwuZXJyVG9PYmoobWVzc2FnZSkgfSk7XG4gICAgfVxuICAgIHVsaWQobWVzc2FnZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5fYWRkQ2hlY2soeyBraW5kOiBcInVsaWRcIiwgLi4uZXJyb3JVdGlsLmVyclRvT2JqKG1lc3NhZ2UpIH0pO1xuICAgIH1cbiAgICBiYXNlNjQobWVzc2FnZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5fYWRkQ2hlY2soeyBraW5kOiBcImJhc2U2NFwiLCAuLi5lcnJvclV0aWwuZXJyVG9PYmoobWVzc2FnZSkgfSk7XG4gICAgfVxuICAgIGJhc2U2NHVybChtZXNzYWdlKSB7XG4gICAgICAgIC8vIGJhc2U2NHVybCBlbmNvZGluZyBpcyBhIG1vZGlmaWNhdGlvbiBvZiBiYXNlNjQgdGhhdCBjYW4gc2FmZWx5IGJlIHVzZWQgaW4gVVJMcyBhbmQgZmlsZW5hbWVzXG4gICAgICAgIHJldHVybiB0aGlzLl9hZGRDaGVjayh7XG4gICAgICAgICAgICBraW5kOiBcImJhc2U2NHVybFwiLFxuICAgICAgICAgICAgLi4uZXJyb3JVdGlsLmVyclRvT2JqKG1lc3NhZ2UpLFxuICAgICAgICB9KTtcbiAgICB9XG4gICAgand0KG9wdGlvbnMpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2FkZENoZWNrKHsga2luZDogXCJqd3RcIiwgLi4uZXJyb3JVdGlsLmVyclRvT2JqKG9wdGlvbnMpIH0pO1xuICAgIH1cbiAgICBpcChvcHRpb25zKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9hZGRDaGVjayh7IGtpbmQ6IFwiaXBcIiwgLi4uZXJyb3JVdGlsLmVyclRvT2JqKG9wdGlvbnMpIH0pO1xuICAgIH1cbiAgICBjaWRyKG9wdGlvbnMpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2FkZENoZWNrKHsga2luZDogXCJjaWRyXCIsIC4uLmVycm9yVXRpbC5lcnJUb09iaihvcHRpb25zKSB9KTtcbiAgICB9XG4gICAgZGF0ZXRpbWUob3B0aW9ucykge1xuICAgICAgICBpZiAodHlwZW9mIG9wdGlvbnMgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9hZGRDaGVjayh7XG4gICAgICAgICAgICAgICAga2luZDogXCJkYXRldGltZVwiLFxuICAgICAgICAgICAgICAgIHByZWNpc2lvbjogbnVsbCxcbiAgICAgICAgICAgICAgICBvZmZzZXQ6IGZhbHNlLFxuICAgICAgICAgICAgICAgIGxvY2FsOiBmYWxzZSxcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiBvcHRpb25zLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX2FkZENoZWNrKHtcbiAgICAgICAgICAgIGtpbmQ6IFwiZGF0ZXRpbWVcIixcbiAgICAgICAgICAgIHByZWNpc2lvbjogdHlwZW9mIG9wdGlvbnM/LnByZWNpc2lvbiA9PT0gXCJ1bmRlZmluZWRcIiA/IG51bGwgOiBvcHRpb25zPy5wcmVjaXNpb24sXG4gICAgICAgICAgICBvZmZzZXQ6IG9wdGlvbnM/Lm9mZnNldCA/PyBmYWxzZSxcbiAgICAgICAgICAgIGxvY2FsOiBvcHRpb25zPy5sb2NhbCA/PyBmYWxzZSxcbiAgICAgICAgICAgIC4uLmVycm9yVXRpbC5lcnJUb09iaihvcHRpb25zPy5tZXNzYWdlKSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIGRhdGUobWVzc2FnZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5fYWRkQ2hlY2soeyBraW5kOiBcImRhdGVcIiwgbWVzc2FnZSB9KTtcbiAgICB9XG4gICAgdGltZShvcHRpb25zKSB7XG4gICAgICAgIGlmICh0eXBlb2Ygb3B0aW9ucyA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2FkZENoZWNrKHtcbiAgICAgICAgICAgICAgICBraW5kOiBcInRpbWVcIixcbiAgICAgICAgICAgICAgICBwcmVjaXNpb246IG51bGwsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogb3B0aW9ucyxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9hZGRDaGVjayh7XG4gICAgICAgICAgICBraW5kOiBcInRpbWVcIixcbiAgICAgICAgICAgIHByZWNpc2lvbjogdHlwZW9mIG9wdGlvbnM/LnByZWNpc2lvbiA9PT0gXCJ1bmRlZmluZWRcIiA/IG51bGwgOiBvcHRpb25zPy5wcmVjaXNpb24sXG4gICAgICAgICAgICAuLi5lcnJvclV0aWwuZXJyVG9PYmoob3B0aW9ucz8ubWVzc2FnZSksXG4gICAgICAgIH0pO1xuICAgIH1cbiAgICBkdXJhdGlvbihtZXNzYWdlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9hZGRDaGVjayh7IGtpbmQ6IFwiZHVyYXRpb25cIiwgLi4uZXJyb3JVdGlsLmVyclRvT2JqKG1lc3NhZ2UpIH0pO1xuICAgIH1cbiAgICByZWdleChyZWdleCwgbWVzc2FnZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5fYWRkQ2hlY2soe1xuICAgICAgICAgICAga2luZDogXCJyZWdleFwiLFxuICAgICAgICAgICAgcmVnZXg6IHJlZ2V4LFxuICAgICAgICAgICAgLi4uZXJyb3JVdGlsLmVyclRvT2JqKG1lc3NhZ2UpLFxuICAgICAgICB9KTtcbiAgICB9XG4gICAgaW5jbHVkZXModmFsdWUsIG9wdGlvbnMpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2FkZENoZWNrKHtcbiAgICAgICAgICAgIGtpbmQ6IFwiaW5jbHVkZXNcIixcbiAgICAgICAgICAgIHZhbHVlOiB2YWx1ZSxcbiAgICAgICAgICAgIHBvc2l0aW9uOiBvcHRpb25zPy5wb3NpdGlvbixcbiAgICAgICAgICAgIC4uLmVycm9yVXRpbC5lcnJUb09iaihvcHRpb25zPy5tZXNzYWdlKSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHN0YXJ0c1dpdGgodmFsdWUsIG1lc3NhZ2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2FkZENoZWNrKHtcbiAgICAgICAgICAgIGtpbmQ6IFwic3RhcnRzV2l0aFwiLFxuICAgICAgICAgICAgdmFsdWU6IHZhbHVlLFxuICAgICAgICAgICAgLi4uZXJyb3JVdGlsLmVyclRvT2JqKG1lc3NhZ2UpLFxuICAgICAgICB9KTtcbiAgICB9XG4gICAgZW5kc1dpdGgodmFsdWUsIG1lc3NhZ2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2FkZENoZWNrKHtcbiAgICAgICAgICAgIGtpbmQ6IFwiZW5kc1dpdGhcIixcbiAgICAgICAgICAgIHZhbHVlOiB2YWx1ZSxcbiAgICAgICAgICAgIC4uLmVycm9yVXRpbC5lcnJUb09iaihtZXNzYWdlKSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIG1pbihtaW5MZW5ndGgsIG1lc3NhZ2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2FkZENoZWNrKHtcbiAgICAgICAgICAgIGtpbmQ6IFwibWluXCIsXG4gICAgICAgICAgICB2YWx1ZTogbWluTGVuZ3RoLFxuICAgICAgICAgICAgLi4uZXJyb3JVdGlsLmVyclRvT2JqKG1lc3NhZ2UpLFxuICAgICAgICB9KTtcbiAgICB9XG4gICAgbWF4KG1heExlbmd0aCwgbWVzc2FnZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5fYWRkQ2hlY2soe1xuICAgICAgICAgICAga2luZDogXCJtYXhcIixcbiAgICAgICAgICAgIHZhbHVlOiBtYXhMZW5ndGgsXG4gICAgICAgICAgICAuLi5lcnJvclV0aWwuZXJyVG9PYmoobWVzc2FnZSksXG4gICAgICAgIH0pO1xuICAgIH1cbiAgICBsZW5ndGgobGVuLCBtZXNzYWdlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9hZGRDaGVjayh7XG4gICAgICAgICAgICBraW5kOiBcImxlbmd0aFwiLFxuICAgICAgICAgICAgdmFsdWU6IGxlbixcbiAgICAgICAgICAgIC4uLmVycm9yVXRpbC5lcnJUb09iaihtZXNzYWdlKSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEVxdWl2YWxlbnQgdG8gYC5taW4oMSlgXG4gICAgICovXG4gICAgbm9uZW1wdHkobWVzc2FnZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5taW4oMSwgZXJyb3JVdGlsLmVyclRvT2JqKG1lc3NhZ2UpKTtcbiAgICB9XG4gICAgdHJpbSgpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBab2RTdHJpbmcoe1xuICAgICAgICAgICAgLi4udGhpcy5fZGVmLFxuICAgICAgICAgICAgY2hlY2tzOiBbLi4udGhpcy5fZGVmLmNoZWNrcywgeyBraW5kOiBcInRyaW1cIiB9XSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHRvTG93ZXJDYXNlKCkge1xuICAgICAgICByZXR1cm4gbmV3IFpvZFN0cmluZyh7XG4gICAgICAgICAgICAuLi50aGlzLl9kZWYsXG4gICAgICAgICAgICBjaGVja3M6IFsuLi50aGlzLl9kZWYuY2hlY2tzLCB7IGtpbmQ6IFwidG9Mb3dlckNhc2VcIiB9XSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHRvVXBwZXJDYXNlKCkge1xuICAgICAgICByZXR1cm4gbmV3IFpvZFN0cmluZyh7XG4gICAgICAgICAgICAuLi50aGlzLl9kZWYsXG4gICAgICAgICAgICBjaGVja3M6IFsuLi50aGlzLl9kZWYuY2hlY2tzLCB7IGtpbmQ6IFwidG9VcHBlckNhc2VcIiB9XSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIGdldCBpc0RhdGV0aW1lKCkge1xuICAgICAgICByZXR1cm4gISF0aGlzLl9kZWYuY2hlY2tzLmZpbmQoKGNoKSA9PiBjaC5raW5kID09PSBcImRhdGV0aW1lXCIpO1xuICAgIH1cbiAgICBnZXQgaXNEYXRlKCkge1xuICAgICAgICByZXR1cm4gISF0aGlzLl9kZWYuY2hlY2tzLmZpbmQoKGNoKSA9PiBjaC5raW5kID09PSBcImRhdGVcIik7XG4gICAgfVxuICAgIGdldCBpc1RpbWUoKSB7XG4gICAgICAgIHJldHVybiAhIXRoaXMuX2RlZi5jaGVja3MuZmluZCgoY2gpID0+IGNoLmtpbmQgPT09IFwidGltZVwiKTtcbiAgICB9XG4gICAgZ2V0IGlzRHVyYXRpb24oKSB7XG4gICAgICAgIHJldHVybiAhIXRoaXMuX2RlZi5jaGVja3MuZmluZCgoY2gpID0+IGNoLmtpbmQgPT09IFwiZHVyYXRpb25cIik7XG4gICAgfVxuICAgIGdldCBpc0VtYWlsKCkge1xuICAgICAgICByZXR1cm4gISF0aGlzLl9kZWYuY2hlY2tzLmZpbmQoKGNoKSA9PiBjaC5raW5kID09PSBcImVtYWlsXCIpO1xuICAgIH1cbiAgICBnZXQgaXNVUkwoKSB7XG4gICAgICAgIHJldHVybiAhIXRoaXMuX2RlZi5jaGVja3MuZmluZCgoY2gpID0+IGNoLmtpbmQgPT09IFwidXJsXCIpO1xuICAgIH1cbiAgICBnZXQgaXNFbW9qaSgpIHtcbiAgICAgICAgcmV0dXJuICEhdGhpcy5fZGVmLmNoZWNrcy5maW5kKChjaCkgPT4gY2gua2luZCA9PT0gXCJlbW9qaVwiKTtcbiAgICB9XG4gICAgZ2V0IGlzVVVJRCgpIHtcbiAgICAgICAgcmV0dXJuICEhdGhpcy5fZGVmLmNoZWNrcy5maW5kKChjaCkgPT4gY2gua2luZCA9PT0gXCJ1dWlkXCIpO1xuICAgIH1cbiAgICBnZXQgaXNOQU5PSUQoKSB7XG4gICAgICAgIHJldHVybiAhIXRoaXMuX2RlZi5jaGVja3MuZmluZCgoY2gpID0+IGNoLmtpbmQgPT09IFwibmFub2lkXCIpO1xuICAgIH1cbiAgICBnZXQgaXNDVUlEKCkge1xuICAgICAgICByZXR1cm4gISF0aGlzLl9kZWYuY2hlY2tzLmZpbmQoKGNoKSA9PiBjaC5raW5kID09PSBcImN1aWRcIik7XG4gICAgfVxuICAgIGdldCBpc0NVSUQyKCkge1xuICAgICAgICByZXR1cm4gISF0aGlzLl9kZWYuY2hlY2tzLmZpbmQoKGNoKSA9PiBjaC5raW5kID09PSBcImN1aWQyXCIpO1xuICAgIH1cbiAgICBnZXQgaXNVTElEKCkge1xuICAgICAgICByZXR1cm4gISF0aGlzLl9kZWYuY2hlY2tzLmZpbmQoKGNoKSA9PiBjaC5raW5kID09PSBcInVsaWRcIik7XG4gICAgfVxuICAgIGdldCBpc0lQKCkge1xuICAgICAgICByZXR1cm4gISF0aGlzLl9kZWYuY2hlY2tzLmZpbmQoKGNoKSA9PiBjaC5raW5kID09PSBcImlwXCIpO1xuICAgIH1cbiAgICBnZXQgaXNDSURSKCkge1xuICAgICAgICByZXR1cm4gISF0aGlzLl9kZWYuY2hlY2tzLmZpbmQoKGNoKSA9PiBjaC5raW5kID09PSBcImNpZHJcIik7XG4gICAgfVxuICAgIGdldCBpc0Jhc2U2NCgpIHtcbiAgICAgICAgcmV0dXJuICEhdGhpcy5fZGVmLmNoZWNrcy5maW5kKChjaCkgPT4gY2gua2luZCA9PT0gXCJiYXNlNjRcIik7XG4gICAgfVxuICAgIGdldCBpc0Jhc2U2NHVybCgpIHtcbiAgICAgICAgLy8gYmFzZTY0dXJsIGVuY29kaW5nIGlzIGEgbW9kaWZpY2F0aW9uIG9mIGJhc2U2NCB0aGF0IGNhbiBzYWZlbHkgYmUgdXNlZCBpbiBVUkxzIGFuZCBmaWxlbmFtZXNcbiAgICAgICAgcmV0dXJuICEhdGhpcy5fZGVmLmNoZWNrcy5maW5kKChjaCkgPT4gY2gua2luZCA9PT0gXCJiYXNlNjR1cmxcIik7XG4gICAgfVxuICAgIGdldCBtaW5MZW5ndGgoKSB7XG4gICAgICAgIGxldCBtaW4gPSBudWxsO1xuICAgICAgICBmb3IgKGNvbnN0IGNoIG9mIHRoaXMuX2RlZi5jaGVja3MpIHtcbiAgICAgICAgICAgIGlmIChjaC5raW5kID09PSBcIm1pblwiKSB7XG4gICAgICAgICAgICAgICAgaWYgKG1pbiA9PT0gbnVsbCB8fCBjaC52YWx1ZSA+IG1pbilcbiAgICAgICAgICAgICAgICAgICAgbWluID0gY2gudmFsdWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG1pbjtcbiAgICB9XG4gICAgZ2V0IG1heExlbmd0aCgpIHtcbiAgICAgICAgbGV0IG1heCA9IG51bGw7XG4gICAgICAgIGZvciAoY29uc3QgY2ggb2YgdGhpcy5fZGVmLmNoZWNrcykge1xuICAgICAgICAgICAgaWYgKGNoLmtpbmQgPT09IFwibWF4XCIpIHtcbiAgICAgICAgICAgICAgICBpZiAobWF4ID09PSBudWxsIHx8IGNoLnZhbHVlIDwgbWF4KVxuICAgICAgICAgICAgICAgICAgICBtYXggPSBjaC52YWx1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbWF4O1xuICAgIH1cbn1cblpvZFN0cmluZy5jcmVhdGUgPSAocGFyYW1zKSA9PiB7XG4gICAgcmV0dXJuIG5ldyBab2RTdHJpbmcoe1xuICAgICAgICBjaGVja3M6IFtdLFxuICAgICAgICB0eXBlTmFtZTogWm9kRmlyc3RQYXJ0eVR5cGVLaW5kLlpvZFN0cmluZyxcbiAgICAgICAgY29lcmNlOiBwYXJhbXM/LmNvZXJjZSA/PyBmYWxzZSxcbiAgICAgICAgLi4ucHJvY2Vzc0NyZWF0ZVBhcmFtcyhwYXJhbXMpLFxuICAgIH0pO1xufTtcbi8vIGh0dHBzOi8vc3RhY2tvdmVyZmxvdy5jb20vcXVlc3Rpb25zLzM5NjY0ODQvd2h5LWRvZXMtbW9kdWx1cy1vcGVyYXRvci1yZXR1cm4tZnJhY3Rpb25hbC1udW1iZXItaW4tamF2YXNjcmlwdC8zMTcxMTAzNCMzMTcxMTAzNFxuZnVuY3Rpb24gZmxvYXRTYWZlUmVtYWluZGVyKHZhbCwgc3RlcCkge1xuICAgIGNvbnN0IHZhbERlY0NvdW50ID0gKHZhbC50b1N0cmluZygpLnNwbGl0KFwiLlwiKVsxXSB8fCBcIlwiKS5sZW5ndGg7XG4gICAgY29uc3Qgc3RlcERlY0NvdW50ID0gKHN0ZXAudG9TdHJpbmcoKS5zcGxpdChcIi5cIilbMV0gfHwgXCJcIikubGVuZ3RoO1xuICAgIGNvbnN0IGRlY0NvdW50ID0gdmFsRGVjQ291bnQgPiBzdGVwRGVjQ291bnQgPyB2YWxEZWNDb3VudCA6IHN0ZXBEZWNDb3VudDtcbiAgICBjb25zdCB2YWxJbnQgPSBOdW1iZXIucGFyc2VJbnQodmFsLnRvRml4ZWQoZGVjQ291bnQpLnJlcGxhY2UoXCIuXCIsIFwiXCIpKTtcbiAgICBjb25zdCBzdGVwSW50ID0gTnVtYmVyLnBhcnNlSW50KHN0ZXAudG9GaXhlZChkZWNDb3VudCkucmVwbGFjZShcIi5cIiwgXCJcIikpO1xuICAgIHJldHVybiAodmFsSW50ICUgc3RlcEludCkgLyAxMCAqKiBkZWNDb3VudDtcbn1cbmV4cG9ydCBjbGFzcyBab2ROdW1iZXIgZXh0ZW5kcyBab2RUeXBlIHtcbiAgICBjb25zdHJ1Y3RvcigpIHtcbiAgICAgICAgc3VwZXIoLi4uYXJndW1lbnRzKTtcbiAgICAgICAgdGhpcy5taW4gPSB0aGlzLmd0ZTtcbiAgICAgICAgdGhpcy5tYXggPSB0aGlzLmx0ZTtcbiAgICAgICAgdGhpcy5zdGVwID0gdGhpcy5tdWx0aXBsZU9mO1xuICAgIH1cbiAgICBfcGFyc2UoaW5wdXQpIHtcbiAgICAgICAgaWYgKHRoaXMuX2RlZi5jb2VyY2UpIHtcbiAgICAgICAgICAgIGlucHV0LmRhdGEgPSBOdW1iZXIoaW5wdXQuZGF0YSk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcGFyc2VkVHlwZSA9IHRoaXMuX2dldFR5cGUoaW5wdXQpO1xuICAgICAgICBpZiAocGFyc2VkVHlwZSAhPT0gWm9kUGFyc2VkVHlwZS5udW1iZXIpIHtcbiAgICAgICAgICAgIGNvbnN0IGN0eCA9IHRoaXMuX2dldE9yUmV0dXJuQ3R4KGlucHV0KTtcbiAgICAgICAgICAgIGFkZElzc3VlVG9Db250ZXh0KGN0eCwge1xuICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS5pbnZhbGlkX3R5cGUsXG4gICAgICAgICAgICAgICAgZXhwZWN0ZWQ6IFpvZFBhcnNlZFR5cGUubnVtYmVyLFxuICAgICAgICAgICAgICAgIHJlY2VpdmVkOiBjdHgucGFyc2VkVHlwZSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIElOVkFMSUQ7XG4gICAgICAgIH1cbiAgICAgICAgbGV0IGN0eCA9IHVuZGVmaW5lZDtcbiAgICAgICAgY29uc3Qgc3RhdHVzID0gbmV3IFBhcnNlU3RhdHVzKCk7XG4gICAgICAgIGZvciAoY29uc3QgY2hlY2sgb2YgdGhpcy5fZGVmLmNoZWNrcykge1xuICAgICAgICAgICAgaWYgKGNoZWNrLmtpbmQgPT09IFwiaW50XCIpIHtcbiAgICAgICAgICAgICAgICBpZiAoIXV0aWwuaXNJbnRlZ2VyKGlucHV0LmRhdGEpKSB7XG4gICAgICAgICAgICAgICAgICAgIGN0eCA9IHRoaXMuX2dldE9yUmV0dXJuQ3R4KGlucHV0LCBjdHgpO1xuICAgICAgICAgICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS5pbnZhbGlkX3R5cGUsXG4gICAgICAgICAgICAgICAgICAgICAgICBleHBlY3RlZDogXCJpbnRlZ2VyXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICByZWNlaXZlZDogXCJmbG9hdFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogY2hlY2subWVzc2FnZSxcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIHN0YXR1cy5kaXJ0eSgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKGNoZWNrLmtpbmQgPT09IFwibWluXCIpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB0b29TbWFsbCA9IGNoZWNrLmluY2x1c2l2ZSA/IGlucHV0LmRhdGEgPCBjaGVjay52YWx1ZSA6IGlucHV0LmRhdGEgPD0gY2hlY2sudmFsdWU7XG4gICAgICAgICAgICAgICAgaWYgKHRvb1NtYWxsKSB7XG4gICAgICAgICAgICAgICAgICAgIGN0eCA9IHRoaXMuX2dldE9yUmV0dXJuQ3R4KGlucHV0LCBjdHgpO1xuICAgICAgICAgICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS50b29fc21hbGwsXG4gICAgICAgICAgICAgICAgICAgICAgICBtaW5pbXVtOiBjaGVjay52YWx1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6IFwibnVtYmVyXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBpbmNsdXNpdmU6IGNoZWNrLmluY2x1c2l2ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGV4YWN0OiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGNoZWNrLm1lc3NhZ2UsXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICBzdGF0dXMuZGlydHkoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChjaGVjay5raW5kID09PSBcIm1heFwiKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdG9vQmlnID0gY2hlY2suaW5jbHVzaXZlID8gaW5wdXQuZGF0YSA+IGNoZWNrLnZhbHVlIDogaW5wdXQuZGF0YSA+PSBjaGVjay52YWx1ZTtcbiAgICAgICAgICAgICAgICBpZiAodG9vQmlnKSB7XG4gICAgICAgICAgICAgICAgICAgIGN0eCA9IHRoaXMuX2dldE9yUmV0dXJuQ3R4KGlucHV0LCBjdHgpO1xuICAgICAgICAgICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS50b29fYmlnLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWF4aW11bTogY2hlY2sudmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIm51bWJlclwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgaW5jbHVzaXZlOiBjaGVjay5pbmNsdXNpdmUsXG4gICAgICAgICAgICAgICAgICAgICAgICBleGFjdDogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBjaGVjay5tZXNzYWdlLFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzLmRpcnR5KCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAoY2hlY2sua2luZCA9PT0gXCJtdWx0aXBsZU9mXCIpIHtcbiAgICAgICAgICAgICAgICBpZiAoZmxvYXRTYWZlUmVtYWluZGVyKGlucHV0LmRhdGEsIGNoZWNrLnZhbHVlKSAhPT0gMCkge1xuICAgICAgICAgICAgICAgICAgICBjdHggPSB0aGlzLl9nZXRPclJldHVybkN0eChpbnB1dCwgY3R4KTtcbiAgICAgICAgICAgICAgICAgICAgYWRkSXNzdWVUb0NvbnRleHQoY3R4LCB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb2RlOiBab2RJc3N1ZUNvZGUubm90X211bHRpcGxlX29mLFxuICAgICAgICAgICAgICAgICAgICAgICAgbXVsdGlwbGVPZjogY2hlY2sudmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBjaGVjay5tZXNzYWdlLFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzLmRpcnR5KCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAoY2hlY2sua2luZCA9PT0gXCJmaW5pdGVcIikge1xuICAgICAgICAgICAgICAgIGlmICghTnVtYmVyLmlzRmluaXRlKGlucHV0LmRhdGEpKSB7XG4gICAgICAgICAgICAgICAgICAgIGN0eCA9IHRoaXMuX2dldE9yUmV0dXJuQ3R4KGlucHV0LCBjdHgpO1xuICAgICAgICAgICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS5ub3RfZmluaXRlLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogY2hlY2subWVzc2FnZSxcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIHN0YXR1cy5kaXJ0eSgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIHV0aWwuYXNzZXJ0TmV2ZXIoY2hlY2spO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB7IHN0YXR1czogc3RhdHVzLnZhbHVlLCB2YWx1ZTogaW5wdXQuZGF0YSB9O1xuICAgIH1cbiAgICBndGUodmFsdWUsIG1lc3NhZ2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc2V0TGltaXQoXCJtaW5cIiwgdmFsdWUsIHRydWUsIGVycm9yVXRpbC50b1N0cmluZyhtZXNzYWdlKSk7XG4gICAgfVxuICAgIGd0KHZhbHVlLCBtZXNzYWdlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnNldExpbWl0KFwibWluXCIsIHZhbHVlLCBmYWxzZSwgZXJyb3JVdGlsLnRvU3RyaW5nKG1lc3NhZ2UpKTtcbiAgICB9XG4gICAgbHRlKHZhbHVlLCBtZXNzYWdlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnNldExpbWl0KFwibWF4XCIsIHZhbHVlLCB0cnVlLCBlcnJvclV0aWwudG9TdHJpbmcobWVzc2FnZSkpO1xuICAgIH1cbiAgICBsdCh2YWx1ZSwgbWVzc2FnZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5zZXRMaW1pdChcIm1heFwiLCB2YWx1ZSwgZmFsc2UsIGVycm9yVXRpbC50b1N0cmluZyhtZXNzYWdlKSk7XG4gICAgfVxuICAgIHNldExpbWl0KGtpbmQsIHZhbHVlLCBpbmNsdXNpdmUsIG1lc3NhZ2UpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBab2ROdW1iZXIoe1xuICAgICAgICAgICAgLi4udGhpcy5fZGVmLFxuICAgICAgICAgICAgY2hlY2tzOiBbXG4gICAgICAgICAgICAgICAgLi4udGhpcy5fZGVmLmNoZWNrcyxcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIGtpbmQsXG4gICAgICAgICAgICAgICAgICAgIHZhbHVlLFxuICAgICAgICAgICAgICAgICAgICBpbmNsdXNpdmUsXG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGVycm9yVXRpbC50b1N0cmluZyhtZXNzYWdlKSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIF9hZGRDaGVjayhjaGVjaykge1xuICAgICAgICByZXR1cm4gbmV3IFpvZE51bWJlcih7XG4gICAgICAgICAgICAuLi50aGlzLl9kZWYsXG4gICAgICAgICAgICBjaGVja3M6IFsuLi50aGlzLl9kZWYuY2hlY2tzLCBjaGVja10sXG4gICAgICAgIH0pO1xuICAgIH1cbiAgICBpbnQobWVzc2FnZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5fYWRkQ2hlY2soe1xuICAgICAgICAgICAga2luZDogXCJpbnRcIixcbiAgICAgICAgICAgIG1lc3NhZ2U6IGVycm9yVXRpbC50b1N0cmluZyhtZXNzYWdlKSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHBvc2l0aXZlKG1lc3NhZ2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2FkZENoZWNrKHtcbiAgICAgICAgICAgIGtpbmQ6IFwibWluXCIsXG4gICAgICAgICAgICB2YWx1ZTogMCxcbiAgICAgICAgICAgIGluY2x1c2l2ZTogZmFsc2UsXG4gICAgICAgICAgICBtZXNzYWdlOiBlcnJvclV0aWwudG9TdHJpbmcobWVzc2FnZSksXG4gICAgICAgIH0pO1xuICAgIH1cbiAgICBuZWdhdGl2ZShtZXNzYWdlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9hZGRDaGVjayh7XG4gICAgICAgICAgICBraW5kOiBcIm1heFwiLFxuICAgICAgICAgICAgdmFsdWU6IDAsXG4gICAgICAgICAgICBpbmNsdXNpdmU6IGZhbHNlLFxuICAgICAgICAgICAgbWVzc2FnZTogZXJyb3JVdGlsLnRvU3RyaW5nKG1lc3NhZ2UpLFxuICAgICAgICB9KTtcbiAgICB9XG4gICAgbm9ucG9zaXRpdmUobWVzc2FnZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5fYWRkQ2hlY2soe1xuICAgICAgICAgICAga2luZDogXCJtYXhcIixcbiAgICAgICAgICAgIHZhbHVlOiAwLFxuICAgICAgICAgICAgaW5jbHVzaXZlOiB0cnVlLFxuICAgICAgICAgICAgbWVzc2FnZTogZXJyb3JVdGlsLnRvU3RyaW5nKG1lc3NhZ2UpLFxuICAgICAgICB9KTtcbiAgICB9XG4gICAgbm9ubmVnYXRpdmUobWVzc2FnZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5fYWRkQ2hlY2soe1xuICAgICAgICAgICAga2luZDogXCJtaW5cIixcbiAgICAgICAgICAgIHZhbHVlOiAwLFxuICAgICAgICAgICAgaW5jbHVzaXZlOiB0cnVlLFxuICAgICAgICAgICAgbWVzc2FnZTogZXJyb3JVdGlsLnRvU3RyaW5nKG1lc3NhZ2UpLFxuICAgICAgICB9KTtcbiAgICB9XG4gICAgbXVsdGlwbGVPZih2YWx1ZSwgbWVzc2FnZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5fYWRkQ2hlY2soe1xuICAgICAgICAgICAga2luZDogXCJtdWx0aXBsZU9mXCIsXG4gICAgICAgICAgICB2YWx1ZTogdmFsdWUsXG4gICAgICAgICAgICBtZXNzYWdlOiBlcnJvclV0aWwudG9TdHJpbmcobWVzc2FnZSksXG4gICAgICAgIH0pO1xuICAgIH1cbiAgICBmaW5pdGUobWVzc2FnZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5fYWRkQ2hlY2soe1xuICAgICAgICAgICAga2luZDogXCJmaW5pdGVcIixcbiAgICAgICAgICAgIG1lc3NhZ2U6IGVycm9yVXRpbC50b1N0cmluZyhtZXNzYWdlKSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHNhZmUobWVzc2FnZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5fYWRkQ2hlY2soe1xuICAgICAgICAgICAga2luZDogXCJtaW5cIixcbiAgICAgICAgICAgIGluY2x1c2l2ZTogdHJ1ZSxcbiAgICAgICAgICAgIHZhbHVlOiBOdW1iZXIuTUlOX1NBRkVfSU5URUdFUixcbiAgICAgICAgICAgIG1lc3NhZ2U6IGVycm9yVXRpbC50b1N0cmluZyhtZXNzYWdlKSxcbiAgICAgICAgfSkuX2FkZENoZWNrKHtcbiAgICAgICAgICAgIGtpbmQ6IFwibWF4XCIsXG4gICAgICAgICAgICBpbmNsdXNpdmU6IHRydWUsXG4gICAgICAgICAgICB2YWx1ZTogTnVtYmVyLk1BWF9TQUZFX0lOVEVHRVIsXG4gICAgICAgICAgICBtZXNzYWdlOiBlcnJvclV0aWwudG9TdHJpbmcobWVzc2FnZSksXG4gICAgICAgIH0pO1xuICAgIH1cbiAgICBnZXQgbWluVmFsdWUoKSB7XG4gICAgICAgIGxldCBtaW4gPSBudWxsO1xuICAgICAgICBmb3IgKGNvbnN0IGNoIG9mIHRoaXMuX2RlZi5jaGVja3MpIHtcbiAgICAgICAgICAgIGlmIChjaC5raW5kID09PSBcIm1pblwiKSB7XG4gICAgICAgICAgICAgICAgaWYgKG1pbiA9PT0gbnVsbCB8fCBjaC52YWx1ZSA+IG1pbilcbiAgICAgICAgICAgICAgICAgICAgbWluID0gY2gudmFsdWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG1pbjtcbiAgICB9XG4gICAgZ2V0IG1heFZhbHVlKCkge1xuICAgICAgICBsZXQgbWF4ID0gbnVsbDtcbiAgICAgICAgZm9yIChjb25zdCBjaCBvZiB0aGlzLl9kZWYuY2hlY2tzKSB7XG4gICAgICAgICAgICBpZiAoY2gua2luZCA9PT0gXCJtYXhcIikge1xuICAgICAgICAgICAgICAgIGlmIChtYXggPT09IG51bGwgfHwgY2gudmFsdWUgPCBtYXgpXG4gICAgICAgICAgICAgICAgICAgIG1heCA9IGNoLnZhbHVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBtYXg7XG4gICAgfVxuICAgIGdldCBpc0ludCgpIHtcbiAgICAgICAgcmV0dXJuICEhdGhpcy5fZGVmLmNoZWNrcy5maW5kKChjaCkgPT4gY2gua2luZCA9PT0gXCJpbnRcIiB8fCAoY2gua2luZCA9PT0gXCJtdWx0aXBsZU9mXCIgJiYgdXRpbC5pc0ludGVnZXIoY2gudmFsdWUpKSk7XG4gICAgfVxuICAgIGdldCBpc0Zpbml0ZSgpIHtcbiAgICAgICAgbGV0IG1heCA9IG51bGw7XG4gICAgICAgIGxldCBtaW4gPSBudWxsO1xuICAgICAgICBmb3IgKGNvbnN0IGNoIG9mIHRoaXMuX2RlZi5jaGVja3MpIHtcbiAgICAgICAgICAgIGlmIChjaC5raW5kID09PSBcImZpbml0ZVwiIHx8IGNoLmtpbmQgPT09IFwiaW50XCIgfHwgY2gua2luZCA9PT0gXCJtdWx0aXBsZU9mXCIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKGNoLmtpbmQgPT09IFwibWluXCIpIHtcbiAgICAgICAgICAgICAgICBpZiAobWluID09PSBudWxsIHx8IGNoLnZhbHVlID4gbWluKVxuICAgICAgICAgICAgICAgICAgICBtaW4gPSBjaC52YWx1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKGNoLmtpbmQgPT09IFwibWF4XCIpIHtcbiAgICAgICAgICAgICAgICBpZiAobWF4ID09PSBudWxsIHx8IGNoLnZhbHVlIDwgbWF4KVxuICAgICAgICAgICAgICAgICAgICBtYXggPSBjaC52YWx1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKG1pbikgJiYgTnVtYmVyLmlzRmluaXRlKG1heCk7XG4gICAgfVxufVxuWm9kTnVtYmVyLmNyZWF0ZSA9IChwYXJhbXMpID0+IHtcbiAgICByZXR1cm4gbmV3IFpvZE51bWJlcih7XG4gICAgICAgIGNoZWNrczogW10sXG4gICAgICAgIHR5cGVOYW1lOiBab2RGaXJzdFBhcnR5VHlwZUtpbmQuWm9kTnVtYmVyLFxuICAgICAgICBjb2VyY2U6IHBhcmFtcz8uY29lcmNlIHx8IGZhbHNlLFxuICAgICAgICAuLi5wcm9jZXNzQ3JlYXRlUGFyYW1zKHBhcmFtcyksXG4gICAgfSk7XG59O1xuZXhwb3J0IGNsYXNzIFpvZEJpZ0ludCBleHRlbmRzIFpvZFR5cGUge1xuICAgIGNvbnN0cnVjdG9yKCkge1xuICAgICAgICBzdXBlciguLi5hcmd1bWVudHMpO1xuICAgICAgICB0aGlzLm1pbiA9IHRoaXMuZ3RlO1xuICAgICAgICB0aGlzLm1heCA9IHRoaXMubHRlO1xuICAgIH1cbiAgICBfcGFyc2UoaW5wdXQpIHtcbiAgICAgICAgaWYgKHRoaXMuX2RlZi5jb2VyY2UpIHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgaW5wdXQuZGF0YSA9IEJpZ0ludChpbnB1dC5kYXRhKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNhdGNoIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5fZ2V0SW52YWxpZElucHV0KGlucHV0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBjb25zdCBwYXJzZWRUeXBlID0gdGhpcy5fZ2V0VHlwZShpbnB1dCk7XG4gICAgICAgIGlmIChwYXJzZWRUeXBlICE9PSBab2RQYXJzZWRUeXBlLmJpZ2ludCkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2dldEludmFsaWRJbnB1dChpbnB1dCk7XG4gICAgICAgIH1cbiAgICAgICAgbGV0IGN0eCA9IHVuZGVmaW5lZDtcbiAgICAgICAgY29uc3Qgc3RhdHVzID0gbmV3IFBhcnNlU3RhdHVzKCk7XG4gICAgICAgIGZvciAoY29uc3QgY2hlY2sgb2YgdGhpcy5fZGVmLmNoZWNrcykge1xuICAgICAgICAgICAgaWYgKGNoZWNrLmtpbmQgPT09IFwibWluXCIpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB0b29TbWFsbCA9IGNoZWNrLmluY2x1c2l2ZSA/IGlucHV0LmRhdGEgPCBjaGVjay52YWx1ZSA6IGlucHV0LmRhdGEgPD0gY2hlY2sudmFsdWU7XG4gICAgICAgICAgICAgICAgaWYgKHRvb1NtYWxsKSB7XG4gICAgICAgICAgICAgICAgICAgIGN0eCA9IHRoaXMuX2dldE9yUmV0dXJuQ3R4KGlucHV0LCBjdHgpO1xuICAgICAgICAgICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS50b29fc21hbGwsXG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiBcImJpZ2ludFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWluaW11bTogY2hlY2sudmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBpbmNsdXNpdmU6IGNoZWNrLmluY2x1c2l2ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGNoZWNrLm1lc3NhZ2UsXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICBzdGF0dXMuZGlydHkoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChjaGVjay5raW5kID09PSBcIm1heFwiKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdG9vQmlnID0gY2hlY2suaW5jbHVzaXZlID8gaW5wdXQuZGF0YSA+IGNoZWNrLnZhbHVlIDogaW5wdXQuZGF0YSA+PSBjaGVjay52YWx1ZTtcbiAgICAgICAgICAgICAgICBpZiAodG9vQmlnKSB7XG4gICAgICAgICAgICAgICAgICAgIGN0eCA9IHRoaXMuX2dldE9yUmV0dXJuQ3R4KGlucHV0LCBjdHgpO1xuICAgICAgICAgICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS50b29fYmlnLFxuICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJiaWdpbnRcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIG1heGltdW06IGNoZWNrLnZhbHVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgaW5jbHVzaXZlOiBjaGVjay5pbmNsdXNpdmUsXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBjaGVjay5tZXNzYWdlLFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzLmRpcnR5KCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAoY2hlY2sua2luZCA9PT0gXCJtdWx0aXBsZU9mXCIpIHtcbiAgICAgICAgICAgICAgICBpZiAoaW5wdXQuZGF0YSAlIGNoZWNrLnZhbHVlICE9PSBCaWdJbnQoMCkpIHtcbiAgICAgICAgICAgICAgICAgICAgY3R4ID0gdGhpcy5fZ2V0T3JSZXR1cm5DdHgoaW5wdXQsIGN0eCk7XG4gICAgICAgICAgICAgICAgICAgIGFkZElzc3VlVG9Db250ZXh0KGN0eCwge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLm5vdF9tdWx0aXBsZV9vZixcbiAgICAgICAgICAgICAgICAgICAgICAgIG11bHRpcGxlT2Y6IGNoZWNrLnZhbHVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogY2hlY2subWVzc2FnZSxcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIHN0YXR1cy5kaXJ0eSgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIHV0aWwuYXNzZXJ0TmV2ZXIoY2hlY2spO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB7IHN0YXR1czogc3RhdHVzLnZhbHVlLCB2YWx1ZTogaW5wdXQuZGF0YSB9O1xuICAgIH1cbiAgICBfZ2V0SW52YWxpZElucHV0KGlucHV0KSB7XG4gICAgICAgIGNvbnN0IGN0eCA9IHRoaXMuX2dldE9yUmV0dXJuQ3R4KGlucHV0KTtcbiAgICAgICAgYWRkSXNzdWVUb0NvbnRleHQoY3R4LCB7XG4gICAgICAgICAgICBjb2RlOiBab2RJc3N1ZUNvZGUuaW52YWxpZF90eXBlLFxuICAgICAgICAgICAgZXhwZWN0ZWQ6IFpvZFBhcnNlZFR5cGUuYmlnaW50LFxuICAgICAgICAgICAgcmVjZWl2ZWQ6IGN0eC5wYXJzZWRUeXBlLFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIElOVkFMSUQ7XG4gICAgfVxuICAgIGd0ZSh2YWx1ZSwgbWVzc2FnZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5zZXRMaW1pdChcIm1pblwiLCB2YWx1ZSwgdHJ1ZSwgZXJyb3JVdGlsLnRvU3RyaW5nKG1lc3NhZ2UpKTtcbiAgICB9XG4gICAgZ3QodmFsdWUsIG1lc3NhZ2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc2V0TGltaXQoXCJtaW5cIiwgdmFsdWUsIGZhbHNlLCBlcnJvclV0aWwudG9TdHJpbmcobWVzc2FnZSkpO1xuICAgIH1cbiAgICBsdGUodmFsdWUsIG1lc3NhZ2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc2V0TGltaXQoXCJtYXhcIiwgdmFsdWUsIHRydWUsIGVycm9yVXRpbC50b1N0cmluZyhtZXNzYWdlKSk7XG4gICAgfVxuICAgIGx0KHZhbHVlLCBtZXNzYWdlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnNldExpbWl0KFwibWF4XCIsIHZhbHVlLCBmYWxzZSwgZXJyb3JVdGlsLnRvU3RyaW5nKG1lc3NhZ2UpKTtcbiAgICB9XG4gICAgc2V0TGltaXQoa2luZCwgdmFsdWUsIGluY2x1c2l2ZSwgbWVzc2FnZSkge1xuICAgICAgICByZXR1cm4gbmV3IFpvZEJpZ0ludCh7XG4gICAgICAgICAgICAuLi50aGlzLl9kZWYsXG4gICAgICAgICAgICBjaGVja3M6IFtcbiAgICAgICAgICAgICAgICAuLi50aGlzLl9kZWYuY2hlY2tzLFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAga2luZCxcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUsXG4gICAgICAgICAgICAgICAgICAgIGluY2x1c2l2ZSxcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogZXJyb3JVdGlsLnRvU3RyaW5nKG1lc3NhZ2UpLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICB9KTtcbiAgICB9XG4gICAgX2FkZENoZWNrKGNoZWNrKSB7XG4gICAgICAgIHJldHVybiBuZXcgWm9kQmlnSW50KHtcbiAgICAgICAgICAgIC4uLnRoaXMuX2RlZixcbiAgICAgICAgICAgIGNoZWNrczogWy4uLnRoaXMuX2RlZi5jaGVja3MsIGNoZWNrXSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHBvc2l0aXZlKG1lc3NhZ2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2FkZENoZWNrKHtcbiAgICAgICAgICAgIGtpbmQ6IFwibWluXCIsXG4gICAgICAgICAgICB2YWx1ZTogQmlnSW50KDApLFxuICAgICAgICAgICAgaW5jbHVzaXZlOiBmYWxzZSxcbiAgICAgICAgICAgIG1lc3NhZ2U6IGVycm9yVXRpbC50b1N0cmluZyhtZXNzYWdlKSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIG5lZ2F0aXZlKG1lc3NhZ2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2FkZENoZWNrKHtcbiAgICAgICAgICAgIGtpbmQ6IFwibWF4XCIsXG4gICAgICAgICAgICB2YWx1ZTogQmlnSW50KDApLFxuICAgICAgICAgICAgaW5jbHVzaXZlOiBmYWxzZSxcbiAgICAgICAgICAgIG1lc3NhZ2U6IGVycm9yVXRpbC50b1N0cmluZyhtZXNzYWdlKSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIG5vbnBvc2l0aXZlKG1lc3NhZ2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2FkZENoZWNrKHtcbiAgICAgICAgICAgIGtpbmQ6IFwibWF4XCIsXG4gICAgICAgICAgICB2YWx1ZTogQmlnSW50KDApLFxuICAgICAgICAgICAgaW5jbHVzaXZlOiB0cnVlLFxuICAgICAgICAgICAgbWVzc2FnZTogZXJyb3JVdGlsLnRvU3RyaW5nKG1lc3NhZ2UpLFxuICAgICAgICB9KTtcbiAgICB9XG4gICAgbm9ubmVnYXRpdmUobWVzc2FnZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5fYWRkQ2hlY2soe1xuICAgICAgICAgICAga2luZDogXCJtaW5cIixcbiAgICAgICAgICAgIHZhbHVlOiBCaWdJbnQoMCksXG4gICAgICAgICAgICBpbmNsdXNpdmU6IHRydWUsXG4gICAgICAgICAgICBtZXNzYWdlOiBlcnJvclV0aWwudG9TdHJpbmcobWVzc2FnZSksXG4gICAgICAgIH0pO1xuICAgIH1cbiAgICBtdWx0aXBsZU9mKHZhbHVlLCBtZXNzYWdlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9hZGRDaGVjayh7XG4gICAgICAgICAgICBraW5kOiBcIm11bHRpcGxlT2ZcIixcbiAgICAgICAgICAgIHZhbHVlLFxuICAgICAgICAgICAgbWVzc2FnZTogZXJyb3JVdGlsLnRvU3RyaW5nKG1lc3NhZ2UpLFxuICAgICAgICB9KTtcbiAgICB9XG4gICAgZ2V0IG1pblZhbHVlKCkge1xuICAgICAgICBsZXQgbWluID0gbnVsbDtcbiAgICAgICAgZm9yIChjb25zdCBjaCBvZiB0aGlzLl9kZWYuY2hlY2tzKSB7XG4gICAgICAgICAgICBpZiAoY2gua2luZCA9PT0gXCJtaW5cIikge1xuICAgICAgICAgICAgICAgIGlmIChtaW4gPT09IG51bGwgfHwgY2gudmFsdWUgPiBtaW4pXG4gICAgICAgICAgICAgICAgICAgIG1pbiA9IGNoLnZhbHVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBtaW47XG4gICAgfVxuICAgIGdldCBtYXhWYWx1ZSgpIHtcbiAgICAgICAgbGV0IG1heCA9IG51bGw7XG4gICAgICAgIGZvciAoY29uc3QgY2ggb2YgdGhpcy5fZGVmLmNoZWNrcykge1xuICAgICAgICAgICAgaWYgKGNoLmtpbmQgPT09IFwibWF4XCIpIHtcbiAgICAgICAgICAgICAgICBpZiAobWF4ID09PSBudWxsIHx8IGNoLnZhbHVlIDwgbWF4KVxuICAgICAgICAgICAgICAgICAgICBtYXggPSBjaC52YWx1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbWF4O1xuICAgIH1cbn1cblpvZEJpZ0ludC5jcmVhdGUgPSAocGFyYW1zKSA9PiB7XG4gICAgcmV0dXJuIG5ldyBab2RCaWdJbnQoe1xuICAgICAgICBjaGVja3M6IFtdLFxuICAgICAgICB0eXBlTmFtZTogWm9kRmlyc3RQYXJ0eVR5cGVLaW5kLlpvZEJpZ0ludCxcbiAgICAgICAgY29lcmNlOiBwYXJhbXM/LmNvZXJjZSA/PyBmYWxzZSxcbiAgICAgICAgLi4ucHJvY2Vzc0NyZWF0ZVBhcmFtcyhwYXJhbXMpLFxuICAgIH0pO1xufTtcbmV4cG9ydCBjbGFzcyBab2RCb29sZWFuIGV4dGVuZHMgWm9kVHlwZSB7XG4gICAgX3BhcnNlKGlucHV0KSB7XG4gICAgICAgIGlmICh0aGlzLl9kZWYuY29lcmNlKSB7XG4gICAgICAgICAgICBpbnB1dC5kYXRhID0gQm9vbGVhbihpbnB1dC5kYXRhKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBwYXJzZWRUeXBlID0gdGhpcy5fZ2V0VHlwZShpbnB1dCk7XG4gICAgICAgIGlmIChwYXJzZWRUeXBlICE9PSBab2RQYXJzZWRUeXBlLmJvb2xlYW4pIHtcbiAgICAgICAgICAgIGNvbnN0IGN0eCA9IHRoaXMuX2dldE9yUmV0dXJuQ3R4KGlucHV0KTtcbiAgICAgICAgICAgIGFkZElzc3VlVG9Db250ZXh0KGN0eCwge1xuICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS5pbnZhbGlkX3R5cGUsXG4gICAgICAgICAgICAgICAgZXhwZWN0ZWQ6IFpvZFBhcnNlZFR5cGUuYm9vbGVhbixcbiAgICAgICAgICAgICAgICByZWNlaXZlZDogY3R4LnBhcnNlZFR5cGUsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiBJTlZBTElEO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBPSyhpbnB1dC5kYXRhKTtcbiAgICB9XG59XG5ab2RCb29sZWFuLmNyZWF0ZSA9IChwYXJhbXMpID0+IHtcbiAgICByZXR1cm4gbmV3IFpvZEJvb2xlYW4oe1xuICAgICAgICB0eXBlTmFtZTogWm9kRmlyc3RQYXJ0eVR5cGVLaW5kLlpvZEJvb2xlYW4sXG4gICAgICAgIGNvZXJjZTogcGFyYW1zPy5jb2VyY2UgfHwgZmFsc2UsXG4gICAgICAgIC4uLnByb2Nlc3NDcmVhdGVQYXJhbXMocGFyYW1zKSxcbiAgICB9KTtcbn07XG5leHBvcnQgY2xhc3MgWm9kRGF0ZSBleHRlbmRzIFpvZFR5cGUge1xuICAgIF9wYXJzZShpbnB1dCkge1xuICAgICAgICBpZiAodGhpcy5fZGVmLmNvZXJjZSkge1xuICAgICAgICAgICAgaW5wdXQuZGF0YSA9IG5ldyBEYXRlKGlucHV0LmRhdGEpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHBhcnNlZFR5cGUgPSB0aGlzLl9nZXRUeXBlKGlucHV0KTtcbiAgICAgICAgaWYgKHBhcnNlZFR5cGUgIT09IFpvZFBhcnNlZFR5cGUuZGF0ZSkge1xuICAgICAgICAgICAgY29uc3QgY3R4ID0gdGhpcy5fZ2V0T3JSZXR1cm5DdHgoaW5wdXQpO1xuICAgICAgICAgICAgYWRkSXNzdWVUb0NvbnRleHQoY3R4LCB7XG4gICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLmludmFsaWRfdHlwZSxcbiAgICAgICAgICAgICAgICBleHBlY3RlZDogWm9kUGFyc2VkVHlwZS5kYXRlLFxuICAgICAgICAgICAgICAgIHJlY2VpdmVkOiBjdHgucGFyc2VkVHlwZSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIElOVkFMSUQ7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKE51bWJlci5pc05hTihpbnB1dC5kYXRhLmdldFRpbWUoKSkpIHtcbiAgICAgICAgICAgIGNvbnN0IGN0eCA9IHRoaXMuX2dldE9yUmV0dXJuQ3R4KGlucHV0KTtcbiAgICAgICAgICAgIGFkZElzc3VlVG9Db250ZXh0KGN0eCwge1xuICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS5pbnZhbGlkX2RhdGUsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiBJTlZBTElEO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHN0YXR1cyA9IG5ldyBQYXJzZVN0YXR1cygpO1xuICAgICAgICBsZXQgY3R4ID0gdW5kZWZpbmVkO1xuICAgICAgICBmb3IgKGNvbnN0IGNoZWNrIG9mIHRoaXMuX2RlZi5jaGVja3MpIHtcbiAgICAgICAgICAgIGlmIChjaGVjay5raW5kID09PSBcIm1pblwiKSB7XG4gICAgICAgICAgICAgICAgaWYgKGlucHV0LmRhdGEuZ2V0VGltZSgpIDwgY2hlY2sudmFsdWUpIHtcbiAgICAgICAgICAgICAgICAgICAgY3R4ID0gdGhpcy5fZ2V0T3JSZXR1cm5DdHgoaW5wdXQsIGN0eCk7XG4gICAgICAgICAgICAgICAgICAgIGFkZElzc3VlVG9Db250ZXh0KGN0eCwge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLnRvb19zbWFsbCxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGNoZWNrLm1lc3NhZ2UsXG4gICAgICAgICAgICAgICAgICAgICAgICBpbmNsdXNpdmU6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBleGFjdDogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgICAgICBtaW5pbXVtOiBjaGVjay52YWx1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6IFwiZGF0ZVwiLFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzLmRpcnR5KCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAoY2hlY2sua2luZCA9PT0gXCJtYXhcIikge1xuICAgICAgICAgICAgICAgIGlmIChpbnB1dC5kYXRhLmdldFRpbWUoKSA+IGNoZWNrLnZhbHVlKSB7XG4gICAgICAgICAgICAgICAgICAgIGN0eCA9IHRoaXMuX2dldE9yUmV0dXJuQ3R4KGlucHV0LCBjdHgpO1xuICAgICAgICAgICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS50b29fYmlnLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogY2hlY2subWVzc2FnZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGluY2x1c2l2ZTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGV4YWN0OiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1heGltdW06IGNoZWNrLnZhbHVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJkYXRlXCIsXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICBzdGF0dXMuZGlydHkoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICB1dGlsLmFzc2VydE5ldmVyKGNoZWNrKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdHVzOiBzdGF0dXMudmFsdWUsXG4gICAgICAgICAgICB2YWx1ZTogbmV3IERhdGUoaW5wdXQuZGF0YS5nZXRUaW1lKCkpLFxuICAgICAgICB9O1xuICAgIH1cbiAgICBfYWRkQ2hlY2soY2hlY2spIHtcbiAgICAgICAgcmV0dXJuIG5ldyBab2REYXRlKHtcbiAgICAgICAgICAgIC4uLnRoaXMuX2RlZixcbiAgICAgICAgICAgIGNoZWNrczogWy4uLnRoaXMuX2RlZi5jaGVja3MsIGNoZWNrXSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIG1pbihtaW5EYXRlLCBtZXNzYWdlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9hZGRDaGVjayh7XG4gICAgICAgICAgICBraW5kOiBcIm1pblwiLFxuICAgICAgICAgICAgdmFsdWU6IG1pbkRhdGUuZ2V0VGltZSgpLFxuICAgICAgICAgICAgbWVzc2FnZTogZXJyb3JVdGlsLnRvU3RyaW5nKG1lc3NhZ2UpLFxuICAgICAgICB9KTtcbiAgICB9XG4gICAgbWF4KG1heERhdGUsIG1lc3NhZ2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2FkZENoZWNrKHtcbiAgICAgICAgICAgIGtpbmQ6IFwibWF4XCIsXG4gICAgICAgICAgICB2YWx1ZTogbWF4RGF0ZS5nZXRUaW1lKCksXG4gICAgICAgICAgICBtZXNzYWdlOiBlcnJvclV0aWwudG9TdHJpbmcobWVzc2FnZSksXG4gICAgICAgIH0pO1xuICAgIH1cbiAgICBnZXQgbWluRGF0ZSgpIHtcbiAgICAgICAgbGV0IG1pbiA9IG51bGw7XG4gICAgICAgIGZvciAoY29uc3QgY2ggb2YgdGhpcy5fZGVmLmNoZWNrcykge1xuICAgICAgICAgICAgaWYgKGNoLmtpbmQgPT09IFwibWluXCIpIHtcbiAgICAgICAgICAgICAgICBpZiAobWluID09PSBudWxsIHx8IGNoLnZhbHVlID4gbWluKVxuICAgICAgICAgICAgICAgICAgICBtaW4gPSBjaC52YWx1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbWluICE9IG51bGwgPyBuZXcgRGF0ZShtaW4pIDogbnVsbDtcbiAgICB9XG4gICAgZ2V0IG1heERhdGUoKSB7XG4gICAgICAgIGxldCBtYXggPSBudWxsO1xuICAgICAgICBmb3IgKGNvbnN0IGNoIG9mIHRoaXMuX2RlZi5jaGVja3MpIHtcbiAgICAgICAgICAgIGlmIChjaC5raW5kID09PSBcIm1heFwiKSB7XG4gICAgICAgICAgICAgICAgaWYgKG1heCA9PT0gbnVsbCB8fCBjaC52YWx1ZSA8IG1heClcbiAgICAgICAgICAgICAgICAgICAgbWF4ID0gY2gudmFsdWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG1heCAhPSBudWxsID8gbmV3IERhdGUobWF4KSA6IG51bGw7XG4gICAgfVxufVxuWm9kRGF0ZS5jcmVhdGUgPSAocGFyYW1zKSA9PiB7XG4gICAgcmV0dXJuIG5ldyBab2REYXRlKHtcbiAgICAgICAgY2hlY2tzOiBbXSxcbiAgICAgICAgY29lcmNlOiBwYXJhbXM/LmNvZXJjZSB8fCBmYWxzZSxcbiAgICAgICAgdHlwZU5hbWU6IFpvZEZpcnN0UGFydHlUeXBlS2luZC5ab2REYXRlLFxuICAgICAgICAuLi5wcm9jZXNzQ3JlYXRlUGFyYW1zKHBhcmFtcyksXG4gICAgfSk7XG59O1xuZXhwb3J0IGNsYXNzIFpvZFN5bWJvbCBleHRlbmRzIFpvZFR5cGUge1xuICAgIF9wYXJzZShpbnB1dCkge1xuICAgICAgICBjb25zdCBwYXJzZWRUeXBlID0gdGhpcy5fZ2V0VHlwZShpbnB1dCk7XG4gICAgICAgIGlmIChwYXJzZWRUeXBlICE9PSBab2RQYXJzZWRUeXBlLnN5bWJvbCkge1xuICAgICAgICAgICAgY29uc3QgY3R4ID0gdGhpcy5fZ2V0T3JSZXR1cm5DdHgoaW5wdXQpO1xuICAgICAgICAgICAgYWRkSXNzdWVUb0NvbnRleHQoY3R4LCB7XG4gICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLmludmFsaWRfdHlwZSxcbiAgICAgICAgICAgICAgICBleHBlY3RlZDogWm9kUGFyc2VkVHlwZS5zeW1ib2wsXG4gICAgICAgICAgICAgICAgcmVjZWl2ZWQ6IGN0eC5wYXJzZWRUeXBlLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gSU5WQUxJRDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gT0soaW5wdXQuZGF0YSk7XG4gICAgfVxufVxuWm9kU3ltYm9sLmNyZWF0ZSA9IChwYXJhbXMpID0+IHtcbiAgICByZXR1cm4gbmV3IFpvZFN5bWJvbCh7XG4gICAgICAgIHR5cGVOYW1lOiBab2RGaXJzdFBhcnR5VHlwZUtpbmQuWm9kU3ltYm9sLFxuICAgICAgICAuLi5wcm9jZXNzQ3JlYXRlUGFyYW1zKHBhcmFtcyksXG4gICAgfSk7XG59O1xuZXhwb3J0IGNsYXNzIFpvZFVuZGVmaW5lZCBleHRlbmRzIFpvZFR5cGUge1xuICAgIF9wYXJzZShpbnB1dCkge1xuICAgICAgICBjb25zdCBwYXJzZWRUeXBlID0gdGhpcy5fZ2V0VHlwZShpbnB1dCk7XG4gICAgICAgIGlmIChwYXJzZWRUeXBlICE9PSBab2RQYXJzZWRUeXBlLnVuZGVmaW5lZCkge1xuICAgICAgICAgICAgY29uc3QgY3R4ID0gdGhpcy5fZ2V0T3JSZXR1cm5DdHgoaW5wdXQpO1xuICAgICAgICAgICAgYWRkSXNzdWVUb0NvbnRleHQoY3R4LCB7XG4gICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLmludmFsaWRfdHlwZSxcbiAgICAgICAgICAgICAgICBleHBlY3RlZDogWm9kUGFyc2VkVHlwZS51bmRlZmluZWQsXG4gICAgICAgICAgICAgICAgcmVjZWl2ZWQ6IGN0eC5wYXJzZWRUeXBlLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gSU5WQUxJRDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gT0soaW5wdXQuZGF0YSk7XG4gICAgfVxufVxuWm9kVW5kZWZpbmVkLmNyZWF0ZSA9IChwYXJhbXMpID0+IHtcbiAgICByZXR1cm4gbmV3IFpvZFVuZGVmaW5lZCh7XG4gICAgICAgIHR5cGVOYW1lOiBab2RGaXJzdFBhcnR5VHlwZUtpbmQuWm9kVW5kZWZpbmVkLFxuICAgICAgICAuLi5wcm9jZXNzQ3JlYXRlUGFyYW1zKHBhcmFtcyksXG4gICAgfSk7XG59O1xuZXhwb3J0IGNsYXNzIFpvZE51bGwgZXh0ZW5kcyBab2RUeXBlIHtcbiAgICBfcGFyc2UoaW5wdXQpIHtcbiAgICAgICAgY29uc3QgcGFyc2VkVHlwZSA9IHRoaXMuX2dldFR5cGUoaW5wdXQpO1xuICAgICAgICBpZiAocGFyc2VkVHlwZSAhPT0gWm9kUGFyc2VkVHlwZS5udWxsKSB7XG4gICAgICAgICAgICBjb25zdCBjdHggPSB0aGlzLl9nZXRPclJldHVybkN0eChpbnB1dCk7XG4gICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICBjb2RlOiBab2RJc3N1ZUNvZGUuaW52YWxpZF90eXBlLFxuICAgICAgICAgICAgICAgIGV4cGVjdGVkOiBab2RQYXJzZWRUeXBlLm51bGwsXG4gICAgICAgICAgICAgICAgcmVjZWl2ZWQ6IGN0eC5wYXJzZWRUeXBlLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gSU5WQUxJRDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gT0soaW5wdXQuZGF0YSk7XG4gICAgfVxufVxuWm9kTnVsbC5jcmVhdGUgPSAocGFyYW1zKSA9PiB7XG4gICAgcmV0dXJuIG5ldyBab2ROdWxsKHtcbiAgICAgICAgdHlwZU5hbWU6IFpvZEZpcnN0UGFydHlUeXBlS2luZC5ab2ROdWxsLFxuICAgICAgICAuLi5wcm9jZXNzQ3JlYXRlUGFyYW1zKHBhcmFtcyksXG4gICAgfSk7XG59O1xuZXhwb3J0IGNsYXNzIFpvZEFueSBleHRlbmRzIFpvZFR5cGUge1xuICAgIGNvbnN0cnVjdG9yKCkge1xuICAgICAgICBzdXBlciguLi5hcmd1bWVudHMpO1xuICAgICAgICAvLyB0byBwcmV2ZW50IGluc3RhbmNlcyBvZiBvdGhlciBjbGFzc2VzIGZyb20gZXh0ZW5kaW5nIFpvZEFueS4gdGhpcyBjYXVzZXMgaXNzdWVzIHdpdGggY2F0Y2hhbGwgaW4gWm9kT2JqZWN0LlxuICAgICAgICB0aGlzLl9hbnkgPSB0cnVlO1xuICAgIH1cbiAgICBfcGFyc2UoaW5wdXQpIHtcbiAgICAgICAgcmV0dXJuIE9LKGlucHV0LmRhdGEpO1xuICAgIH1cbn1cblpvZEFueS5jcmVhdGUgPSAocGFyYW1zKSA9PiB7XG4gICAgcmV0dXJuIG5ldyBab2RBbnkoe1xuICAgICAgICB0eXBlTmFtZTogWm9kRmlyc3RQYXJ0eVR5cGVLaW5kLlpvZEFueSxcbiAgICAgICAgLi4ucHJvY2Vzc0NyZWF0ZVBhcmFtcyhwYXJhbXMpLFxuICAgIH0pO1xufTtcbmV4cG9ydCBjbGFzcyBab2RVbmtub3duIGV4dGVuZHMgWm9kVHlwZSB7XG4gICAgY29uc3RydWN0b3IoKSB7XG4gICAgICAgIHN1cGVyKC4uLmFyZ3VtZW50cyk7XG4gICAgICAgIC8vIHJlcXVpcmVkXG4gICAgICAgIHRoaXMuX3Vua25vd24gPSB0cnVlO1xuICAgIH1cbiAgICBfcGFyc2UoaW5wdXQpIHtcbiAgICAgICAgcmV0dXJuIE9LKGlucHV0LmRhdGEpO1xuICAgIH1cbn1cblpvZFVua25vd24uY3JlYXRlID0gKHBhcmFtcykgPT4ge1xuICAgIHJldHVybiBuZXcgWm9kVW5rbm93bih7XG4gICAgICAgIHR5cGVOYW1lOiBab2RGaXJzdFBhcnR5VHlwZUtpbmQuWm9kVW5rbm93bixcbiAgICAgICAgLi4ucHJvY2Vzc0NyZWF0ZVBhcmFtcyhwYXJhbXMpLFxuICAgIH0pO1xufTtcbmV4cG9ydCBjbGFzcyBab2ROZXZlciBleHRlbmRzIFpvZFR5cGUge1xuICAgIF9wYXJzZShpbnB1dCkge1xuICAgICAgICBjb25zdCBjdHggPSB0aGlzLl9nZXRPclJldHVybkN0eChpbnB1dCk7XG4gICAgICAgIGFkZElzc3VlVG9Db250ZXh0KGN0eCwge1xuICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLmludmFsaWRfdHlwZSxcbiAgICAgICAgICAgIGV4cGVjdGVkOiBab2RQYXJzZWRUeXBlLm5ldmVyLFxuICAgICAgICAgICAgcmVjZWl2ZWQ6IGN0eC5wYXJzZWRUeXBlLFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIElOVkFMSUQ7XG4gICAgfVxufVxuWm9kTmV2ZXIuY3JlYXRlID0gKHBhcmFtcykgPT4ge1xuICAgIHJldHVybiBuZXcgWm9kTmV2ZXIoe1xuICAgICAgICB0eXBlTmFtZTogWm9kRmlyc3RQYXJ0eVR5cGVLaW5kLlpvZE5ldmVyLFxuICAgICAgICAuLi5wcm9jZXNzQ3JlYXRlUGFyYW1zKHBhcmFtcyksXG4gICAgfSk7XG59O1xuZXhwb3J0IGNsYXNzIFpvZFZvaWQgZXh0ZW5kcyBab2RUeXBlIHtcbiAgICBfcGFyc2UoaW5wdXQpIHtcbiAgICAgICAgY29uc3QgcGFyc2VkVHlwZSA9IHRoaXMuX2dldFR5cGUoaW5wdXQpO1xuICAgICAgICBpZiAocGFyc2VkVHlwZSAhPT0gWm9kUGFyc2VkVHlwZS51bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGNvbnN0IGN0eCA9IHRoaXMuX2dldE9yUmV0dXJuQ3R4KGlucHV0KTtcbiAgICAgICAgICAgIGFkZElzc3VlVG9Db250ZXh0KGN0eCwge1xuICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS5pbnZhbGlkX3R5cGUsXG4gICAgICAgICAgICAgICAgZXhwZWN0ZWQ6IFpvZFBhcnNlZFR5cGUudm9pZCxcbiAgICAgICAgICAgICAgICByZWNlaXZlZDogY3R4LnBhcnNlZFR5cGUsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiBJTlZBTElEO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBPSyhpbnB1dC5kYXRhKTtcbiAgICB9XG59XG5ab2RWb2lkLmNyZWF0ZSA9IChwYXJhbXMpID0+IHtcbiAgICByZXR1cm4gbmV3IFpvZFZvaWQoe1xuICAgICAgICB0eXBlTmFtZTogWm9kRmlyc3RQYXJ0eVR5cGVLaW5kLlpvZFZvaWQsXG4gICAgICAgIC4uLnByb2Nlc3NDcmVhdGVQYXJhbXMocGFyYW1zKSxcbiAgICB9KTtcbn07XG5leHBvcnQgY2xhc3MgWm9kQXJyYXkgZXh0ZW5kcyBab2RUeXBlIHtcbiAgICBfcGFyc2UoaW5wdXQpIHtcbiAgICAgICAgY29uc3QgeyBjdHgsIHN0YXR1cyB9ID0gdGhpcy5fcHJvY2Vzc0lucHV0UGFyYW1zKGlucHV0KTtcbiAgICAgICAgY29uc3QgZGVmID0gdGhpcy5fZGVmO1xuICAgICAgICBpZiAoY3R4LnBhcnNlZFR5cGUgIT09IFpvZFBhcnNlZFR5cGUuYXJyYXkpIHtcbiAgICAgICAgICAgIGFkZElzc3VlVG9Db250ZXh0KGN0eCwge1xuICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS5pbnZhbGlkX3R5cGUsXG4gICAgICAgICAgICAgICAgZXhwZWN0ZWQ6IFpvZFBhcnNlZFR5cGUuYXJyYXksXG4gICAgICAgICAgICAgICAgcmVjZWl2ZWQ6IGN0eC5wYXJzZWRUeXBlLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gSU5WQUxJRDtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZGVmLmV4YWN0TGVuZ3RoICE9PSBudWxsKSB7XG4gICAgICAgICAgICBjb25zdCB0b29CaWcgPSBjdHguZGF0YS5sZW5ndGggPiBkZWYuZXhhY3RMZW5ndGgudmFsdWU7XG4gICAgICAgICAgICBjb25zdCB0b29TbWFsbCA9IGN0eC5kYXRhLmxlbmd0aCA8IGRlZi5leGFjdExlbmd0aC52YWx1ZTtcbiAgICAgICAgICAgIGlmICh0b29CaWcgfHwgdG9vU21hbGwpIHtcbiAgICAgICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICAgICAgY29kZTogdG9vQmlnID8gWm9kSXNzdWVDb2RlLnRvb19iaWcgOiBab2RJc3N1ZUNvZGUudG9vX3NtYWxsLFxuICAgICAgICAgICAgICAgICAgICBtaW5pbXVtOiAodG9vU21hbGwgPyBkZWYuZXhhY3RMZW5ndGgudmFsdWUgOiB1bmRlZmluZWQpLFxuICAgICAgICAgICAgICAgICAgICBtYXhpbXVtOiAodG9vQmlnID8gZGVmLmV4YWN0TGVuZ3RoLnZhbHVlIDogdW5kZWZpbmVkKSxcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJhcnJheVwiLFxuICAgICAgICAgICAgICAgICAgICBpbmNsdXNpdmU6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBkZWYuZXhhY3RMZW5ndGgubWVzc2FnZSxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBzdGF0dXMuZGlydHkoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAoZGVmLm1pbkxlbmd0aCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgaWYgKGN0eC5kYXRhLmxlbmd0aCA8IGRlZi5taW5MZW5ndGgudmFsdWUpIHtcbiAgICAgICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLnRvb19zbWFsbCxcbiAgICAgICAgICAgICAgICAgICAgbWluaW11bTogZGVmLm1pbkxlbmd0aC52YWx1ZSxcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJhcnJheVwiLFxuICAgICAgICAgICAgICAgICAgICBpbmNsdXNpdmU6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgIGV4YWN0OiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogZGVmLm1pbkxlbmd0aC5tZXNzYWdlLFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIHN0YXR1cy5kaXJ0eSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChkZWYubWF4TGVuZ3RoICE9PSBudWxsKSB7XG4gICAgICAgICAgICBpZiAoY3R4LmRhdGEubGVuZ3RoID4gZGVmLm1heExlbmd0aC52YWx1ZSkge1xuICAgICAgICAgICAgICAgIGFkZElzc3VlVG9Db250ZXh0KGN0eCwge1xuICAgICAgICAgICAgICAgICAgICBjb2RlOiBab2RJc3N1ZUNvZGUudG9vX2JpZyxcbiAgICAgICAgICAgICAgICAgICAgbWF4aW11bTogZGVmLm1heExlbmd0aC52YWx1ZSxcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJhcnJheVwiLFxuICAgICAgICAgICAgICAgICAgICBpbmNsdXNpdmU6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgIGV4YWN0OiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogZGVmLm1heExlbmd0aC5tZXNzYWdlLFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIHN0YXR1cy5kaXJ0eSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChjdHguY29tbW9uLmFzeW5jKSB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwoWy4uLmN0eC5kYXRhXS5tYXAoKGl0ZW0sIGkpID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZGVmLnR5cGUuX3BhcnNlQXN5bmMobmV3IFBhcnNlSW5wdXRMYXp5UGF0aChjdHgsIGl0ZW0sIGN0eC5wYXRoLCBpKSk7XG4gICAgICAgICAgICB9KSkudGhlbigocmVzdWx0KSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFBhcnNlU3RhdHVzLm1lcmdlQXJyYXkoc3RhdHVzLCByZXN1bHQpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gWy4uLmN0eC5kYXRhXS5tYXAoKGl0ZW0sIGkpID0+IHtcbiAgICAgICAgICAgIHJldHVybiBkZWYudHlwZS5fcGFyc2VTeW5jKG5ldyBQYXJzZUlucHV0TGF6eVBhdGgoY3R4LCBpdGVtLCBjdHgucGF0aCwgaSkpO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIFBhcnNlU3RhdHVzLm1lcmdlQXJyYXkoc3RhdHVzLCByZXN1bHQpO1xuICAgIH1cbiAgICBnZXQgZWxlbWVudCgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2RlZi50eXBlO1xuICAgIH1cbiAgICBtaW4obWluTGVuZ3RoLCBtZXNzYWdlKSB7XG4gICAgICAgIHJldHVybiBuZXcgWm9kQXJyYXkoe1xuICAgICAgICAgICAgLi4udGhpcy5fZGVmLFxuICAgICAgICAgICAgbWluTGVuZ3RoOiB7IHZhbHVlOiBtaW5MZW5ndGgsIG1lc3NhZ2U6IGVycm9yVXRpbC50b1N0cmluZyhtZXNzYWdlKSB9LFxuICAgICAgICB9KTtcbiAgICB9XG4gICAgbWF4KG1heExlbmd0aCwgbWVzc2FnZSkge1xuICAgICAgICByZXR1cm4gbmV3IFpvZEFycmF5KHtcbiAgICAgICAgICAgIC4uLnRoaXMuX2RlZixcbiAgICAgICAgICAgIG1heExlbmd0aDogeyB2YWx1ZTogbWF4TGVuZ3RoLCBtZXNzYWdlOiBlcnJvclV0aWwudG9TdHJpbmcobWVzc2FnZSkgfSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIGxlbmd0aChsZW4sIG1lc3NhZ2UpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBab2RBcnJheSh7XG4gICAgICAgICAgICAuLi50aGlzLl9kZWYsXG4gICAgICAgICAgICBleGFjdExlbmd0aDogeyB2YWx1ZTogbGVuLCBtZXNzYWdlOiBlcnJvclV0aWwudG9TdHJpbmcobWVzc2FnZSkgfSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIG5vbmVtcHR5KG1lc3NhZ2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMubWluKDEsIG1lc3NhZ2UpO1xuICAgIH1cbn1cblpvZEFycmF5LmNyZWF0ZSA9IChzY2hlbWEsIHBhcmFtcykgPT4ge1xuICAgIHJldHVybiBuZXcgWm9kQXJyYXkoe1xuICAgICAgICB0eXBlOiBzY2hlbWEsXG4gICAgICAgIG1pbkxlbmd0aDogbnVsbCxcbiAgICAgICAgbWF4TGVuZ3RoOiBudWxsLFxuICAgICAgICBleGFjdExlbmd0aDogbnVsbCxcbiAgICAgICAgdHlwZU5hbWU6IFpvZEZpcnN0UGFydHlUeXBlS2luZC5ab2RBcnJheSxcbiAgICAgICAgLi4ucHJvY2Vzc0NyZWF0ZVBhcmFtcyhwYXJhbXMpLFxuICAgIH0pO1xufTtcbmZ1bmN0aW9uIGRlZXBQYXJ0aWFsaWZ5KHNjaGVtYSkge1xuICAgIGlmIChzY2hlbWEgaW5zdGFuY2VvZiBab2RPYmplY3QpIHtcbiAgICAgICAgY29uc3QgbmV3U2hhcGUgPSB7fTtcbiAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gc2NoZW1hLnNoYXBlKSB7XG4gICAgICAgICAgICBjb25zdCBmaWVsZFNjaGVtYSA9IHNjaGVtYS5zaGFwZVtrZXldO1xuICAgICAgICAgICAgbmV3U2hhcGVba2V5XSA9IFpvZE9wdGlvbmFsLmNyZWF0ZShkZWVwUGFydGlhbGlmeShmaWVsZFNjaGVtYSkpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBuZXcgWm9kT2JqZWN0KHtcbiAgICAgICAgICAgIC4uLnNjaGVtYS5fZGVmLFxuICAgICAgICAgICAgc2hhcGU6ICgpID0+IG5ld1NoYXBlLFxuICAgICAgICB9KTtcbiAgICB9XG4gICAgZWxzZSBpZiAoc2NoZW1hIGluc3RhbmNlb2YgWm9kQXJyYXkpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBab2RBcnJheSh7XG4gICAgICAgICAgICAuLi5zY2hlbWEuX2RlZixcbiAgICAgICAgICAgIHR5cGU6IGRlZXBQYXJ0aWFsaWZ5KHNjaGVtYS5lbGVtZW50KSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHNjaGVtYSBpbnN0YW5jZW9mIFpvZE9wdGlvbmFsKSB7XG4gICAgICAgIHJldHVybiBab2RPcHRpb25hbC5jcmVhdGUoZGVlcFBhcnRpYWxpZnkoc2NoZW1hLnVud3JhcCgpKSk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHNjaGVtYSBpbnN0YW5jZW9mIFpvZE51bGxhYmxlKSB7XG4gICAgICAgIHJldHVybiBab2ROdWxsYWJsZS5jcmVhdGUoZGVlcFBhcnRpYWxpZnkoc2NoZW1hLnVud3JhcCgpKSk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHNjaGVtYSBpbnN0YW5jZW9mIFpvZFR1cGxlKSB7XG4gICAgICAgIHJldHVybiBab2RUdXBsZS5jcmVhdGUoc2NoZW1hLml0ZW1zLm1hcCgoaXRlbSkgPT4gZGVlcFBhcnRpYWxpZnkoaXRlbSkpKTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIHJldHVybiBzY2hlbWE7XG4gICAgfVxufVxuZXhwb3J0IGNsYXNzIFpvZE9iamVjdCBleHRlbmRzIFpvZFR5cGUge1xuICAgIGNvbnN0cnVjdG9yKCkge1xuICAgICAgICBzdXBlciguLi5hcmd1bWVudHMpO1xuICAgICAgICB0aGlzLl9jYWNoZWQgPSBudWxsO1xuICAgICAgICAvKipcbiAgICAgICAgICogQGRlcHJlY2F0ZWQgSW4gbW9zdCBjYXNlcywgdGhpcyBpcyBubyBsb25nZXIgbmVlZGVkIC0gdW5rbm93biBwcm9wZXJ0aWVzIGFyZSBub3cgc2lsZW50bHkgc3RyaXBwZWQuXG4gICAgICAgICAqIElmIHlvdSB3YW50IHRvIHBhc3MgdGhyb3VnaCB1bmtub3duIHByb3BlcnRpZXMsIHVzZSBgLnBhc3N0aHJvdWdoKClgIGluc3RlYWQuXG4gICAgICAgICAqL1xuICAgICAgICB0aGlzLm5vbnN0cmljdCA9IHRoaXMucGFzc3Rocm91Z2g7XG4gICAgICAgIC8vIGV4dGVuZDxcbiAgICAgICAgLy8gICBBdWdtZW50YXRpb24gZXh0ZW5kcyBab2RSYXdTaGFwZSxcbiAgICAgICAgLy8gICBOZXdPdXRwdXQgZXh0ZW5kcyB1dGlsLmZsYXR0ZW48e1xuICAgICAgICAvLyAgICAgW2sgaW4ga2V5b2YgQXVnbWVudGF0aW9uIHwga2V5b2YgT3V0cHV0XTogayBleHRlbmRzIGtleW9mIEF1Z21lbnRhdGlvblxuICAgICAgICAvLyAgICAgICA/IEF1Z21lbnRhdGlvbltrXVtcIl9vdXRwdXRcIl1cbiAgICAgICAgLy8gICAgICAgOiBrIGV4dGVuZHMga2V5b2YgT3V0cHV0XG4gICAgICAgIC8vICAgICAgID8gT3V0cHV0W2tdXG4gICAgICAgIC8vICAgICAgIDogbmV2ZXI7XG4gICAgICAgIC8vICAgfT4sXG4gICAgICAgIC8vICAgTmV3SW5wdXQgZXh0ZW5kcyB1dGlsLmZsYXR0ZW48e1xuICAgICAgICAvLyAgICAgW2sgaW4ga2V5b2YgQXVnbWVudGF0aW9uIHwga2V5b2YgSW5wdXRdOiBrIGV4dGVuZHMga2V5b2YgQXVnbWVudGF0aW9uXG4gICAgICAgIC8vICAgICAgID8gQXVnbWVudGF0aW9uW2tdW1wiX2lucHV0XCJdXG4gICAgICAgIC8vICAgICAgIDogayBleHRlbmRzIGtleW9mIElucHV0XG4gICAgICAgIC8vICAgICAgID8gSW5wdXRba11cbiAgICAgICAgLy8gICAgICAgOiBuZXZlcjtcbiAgICAgICAgLy8gICB9PlxuICAgICAgICAvLyA+KFxuICAgICAgICAvLyAgIGF1Z21lbnRhdGlvbjogQXVnbWVudGF0aW9uXG4gICAgICAgIC8vICk6IFpvZE9iamVjdDxcbiAgICAgICAgLy8gICBleHRlbmRTaGFwZTxULCBBdWdtZW50YXRpb24+LFxuICAgICAgICAvLyAgIFVua25vd25LZXlzLFxuICAgICAgICAvLyAgIENhdGNoYWxsLFxuICAgICAgICAvLyAgIE5ld091dHB1dCxcbiAgICAgICAgLy8gICBOZXdJbnB1dFxuICAgICAgICAvLyA+IHtcbiAgICAgICAgLy8gICByZXR1cm4gbmV3IFpvZE9iamVjdCh7XG4gICAgICAgIC8vICAgICAuLi50aGlzLl9kZWYsXG4gICAgICAgIC8vICAgICBzaGFwZTogKCkgPT4gKHtcbiAgICAgICAgLy8gICAgICAgLi4udGhpcy5fZGVmLnNoYXBlKCksXG4gICAgICAgIC8vICAgICAgIC4uLmF1Z21lbnRhdGlvbixcbiAgICAgICAgLy8gICAgIH0pLFxuICAgICAgICAvLyAgIH0pIGFzIGFueTtcbiAgICAgICAgLy8gfVxuICAgICAgICAvKipcbiAgICAgICAgICogQGRlcHJlY2F0ZWQgVXNlIGAuZXh0ZW5kYCBpbnN0ZWFkXG4gICAgICAgICAqICAqL1xuICAgICAgICB0aGlzLmF1Z21lbnQgPSB0aGlzLmV4dGVuZDtcbiAgICB9XG4gICAgX2dldENhY2hlZCgpIHtcbiAgICAgICAgaWYgKHRoaXMuX2NhY2hlZCAhPT0gbnVsbClcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9jYWNoZWQ7XG4gICAgICAgIGNvbnN0IHNoYXBlID0gdGhpcy5fZGVmLnNoYXBlKCk7XG4gICAgICAgIGNvbnN0IGtleXMgPSB1dGlsLm9iamVjdEtleXMoc2hhcGUpO1xuICAgICAgICB0aGlzLl9jYWNoZWQgPSB7IHNoYXBlLCBrZXlzIH07XG4gICAgICAgIHJldHVybiB0aGlzLl9jYWNoZWQ7XG4gICAgfVxuICAgIF9wYXJzZShpbnB1dCkge1xuICAgICAgICBjb25zdCBwYXJzZWRUeXBlID0gdGhpcy5fZ2V0VHlwZShpbnB1dCk7XG4gICAgICAgIGlmIChwYXJzZWRUeXBlICE9PSBab2RQYXJzZWRUeXBlLm9iamVjdCkge1xuICAgICAgICAgICAgY29uc3QgY3R4ID0gdGhpcy5fZ2V0T3JSZXR1cm5DdHgoaW5wdXQpO1xuICAgICAgICAgICAgYWRkSXNzdWVUb0NvbnRleHQoY3R4LCB7XG4gICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLmludmFsaWRfdHlwZSxcbiAgICAgICAgICAgICAgICBleHBlY3RlZDogWm9kUGFyc2VkVHlwZS5vYmplY3QsXG4gICAgICAgICAgICAgICAgcmVjZWl2ZWQ6IGN0eC5wYXJzZWRUeXBlLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gSU5WQUxJRDtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB7IHN0YXR1cywgY3R4IH0gPSB0aGlzLl9wcm9jZXNzSW5wdXRQYXJhbXMoaW5wdXQpO1xuICAgICAgICBjb25zdCB7IHNoYXBlLCBrZXlzOiBzaGFwZUtleXMgfSA9IHRoaXMuX2dldENhY2hlZCgpO1xuICAgICAgICBjb25zdCBleHRyYUtleXMgPSBbXTtcbiAgICAgICAgaWYgKCEodGhpcy5fZGVmLmNhdGNoYWxsIGluc3RhbmNlb2YgWm9kTmV2ZXIgJiYgdGhpcy5fZGVmLnVua25vd25LZXlzID09PSBcInN0cmlwXCIpKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBjdHguZGF0YSkge1xuICAgICAgICAgICAgICAgIGlmICghc2hhcGVLZXlzLmluY2x1ZGVzKGtleSkpIHtcbiAgICAgICAgICAgICAgICAgICAgZXh0cmFLZXlzLnB1c2goa2V5KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcGFpcnMgPSBbXTtcbiAgICAgICAgZm9yIChjb25zdCBrZXkgb2Ygc2hhcGVLZXlzKSB7XG4gICAgICAgICAgICBjb25zdCBrZXlWYWxpZGF0b3IgPSBzaGFwZVtrZXldO1xuICAgICAgICAgICAgY29uc3QgdmFsdWUgPSBjdHguZGF0YVtrZXldO1xuICAgICAgICAgICAgcGFpcnMucHVzaCh7XG4gICAgICAgICAgICAgICAga2V5OiB7IHN0YXR1czogXCJ2YWxpZFwiLCB2YWx1ZToga2V5IH0sXG4gICAgICAgICAgICAgICAgdmFsdWU6IGtleVZhbGlkYXRvci5fcGFyc2UobmV3IFBhcnNlSW5wdXRMYXp5UGF0aChjdHgsIHZhbHVlLCBjdHgucGF0aCwga2V5KSksXG4gICAgICAgICAgICAgICAgYWx3YXlzU2V0OiBrZXkgaW4gY3R4LmRhdGEsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5fZGVmLmNhdGNoYWxsIGluc3RhbmNlb2YgWm9kTmV2ZXIpIHtcbiAgICAgICAgICAgIGNvbnN0IHVua25vd25LZXlzID0gdGhpcy5fZGVmLnVua25vd25LZXlzO1xuICAgICAgICAgICAgaWYgKHVua25vd25LZXlzID09PSBcInBhc3N0aHJvdWdoXCIpIHtcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBvZiBleHRyYUtleXMpIHtcbiAgICAgICAgICAgICAgICAgICAgcGFpcnMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBrZXk6IHsgc3RhdHVzOiBcInZhbGlkXCIsIHZhbHVlOiBrZXkgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlOiB7IHN0YXR1czogXCJ2YWxpZFwiLCB2YWx1ZTogY3R4LmRhdGFba2V5XSB9LFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmICh1bmtub3duS2V5cyA9PT0gXCJzdHJpY3RcIikge1xuICAgICAgICAgICAgICAgIGlmIChleHRyYUtleXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS51bnJlY29nbml6ZWRfa2V5cyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGtleXM6IGV4dHJhS2V5cyxcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIHN0YXR1cy5kaXJ0eSgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKHVua25vd25LZXlzID09PSBcInN0cmlwXCIpIHtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW50ZXJuYWwgWm9kT2JqZWN0IGVycm9yOiBpbnZhbGlkIHVua25vd25LZXlzIHZhbHVlLmApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgLy8gcnVuIGNhdGNoYWxsIHZhbGlkYXRpb25cbiAgICAgICAgICAgIGNvbnN0IGNhdGNoYWxsID0gdGhpcy5fZGVmLmNhdGNoYWxsO1xuICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgb2YgZXh0cmFLZXlzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdmFsdWUgPSBjdHguZGF0YVtrZXldO1xuICAgICAgICAgICAgICAgIHBhaXJzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICBrZXk6IHsgc3RhdHVzOiBcInZhbGlkXCIsIHZhbHVlOiBrZXkgfSxcbiAgICAgICAgICAgICAgICAgICAgdmFsdWU6IGNhdGNoYWxsLl9wYXJzZShuZXcgUGFyc2VJbnB1dExhenlQYXRoKGN0eCwgdmFsdWUsIGN0eC5wYXRoLCBrZXkpIC8vLCBjdHguY2hpbGQoa2V5KSwgdmFsdWUsIGdldFBhcnNlZFR5cGUodmFsdWUpXG4gICAgICAgICAgICAgICAgICAgICksXG4gICAgICAgICAgICAgICAgICAgIGFsd2F5c1NldDoga2V5IGluIGN0eC5kYXRhLFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChjdHguY29tbW9uLmFzeW5jKSB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAgICAgICAgICAgICAudGhlbihhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3Qgc3luY1BhaXJzID0gW107XG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBwYWlyIG9mIHBhaXJzKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGtleSA9IGF3YWl0IHBhaXIua2V5O1xuICAgICAgICAgICAgICAgICAgICBjb25zdCB2YWx1ZSA9IGF3YWl0IHBhaXIudmFsdWU7XG4gICAgICAgICAgICAgICAgICAgIHN5bmNQYWlycy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGtleSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgYWx3YXlzU2V0OiBwYWlyLmFsd2F5c1NldCxcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiBzeW5jUGFpcnM7XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIC50aGVuKChzeW5jUGFpcnMpID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gUGFyc2VTdGF0dXMubWVyZ2VPYmplY3RTeW5jKHN0YXR1cywgc3luY1BhaXJzKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIFBhcnNlU3RhdHVzLm1lcmdlT2JqZWN0U3luYyhzdGF0dXMsIHBhaXJzKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBnZXQgc2hhcGUoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9kZWYuc2hhcGUoKTtcbiAgICB9XG4gICAgc3RyaWN0KG1lc3NhZ2UpIHtcbiAgICAgICAgZXJyb3JVdGlsLmVyclRvT2JqO1xuICAgICAgICByZXR1cm4gbmV3IFpvZE9iamVjdCh7XG4gICAgICAgICAgICAuLi50aGlzLl9kZWYsXG4gICAgICAgICAgICB1bmtub3duS2V5czogXCJzdHJpY3RcIixcbiAgICAgICAgICAgIC4uLihtZXNzYWdlICE9PSB1bmRlZmluZWRcbiAgICAgICAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgICAgICAgZXJyb3JNYXA6IChpc3N1ZSwgY3R4KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBkZWZhdWx0RXJyb3IgPSB0aGlzLl9kZWYuZXJyb3JNYXA/Lihpc3N1ZSwgY3R4KS5tZXNzYWdlID8/IGN0eC5kZWZhdWx0RXJyb3I7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoaXNzdWUuY29kZSA9PT0gXCJ1bnJlY29nbml6ZWRfa2V5c1wiKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGVycm9yVXRpbC5lcnJUb09iaihtZXNzYWdlKS5tZXNzYWdlID8/IGRlZmF1bHRFcnJvcixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBkZWZhdWx0RXJyb3IsXG4gICAgICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICA6IHt9KSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHN0cmlwKCkge1xuICAgICAgICByZXR1cm4gbmV3IFpvZE9iamVjdCh7XG4gICAgICAgICAgICAuLi50aGlzLl9kZWYsXG4gICAgICAgICAgICB1bmtub3duS2V5czogXCJzdHJpcFwiLFxuICAgICAgICB9KTtcbiAgICB9XG4gICAgcGFzc3Rocm91Z2goKSB7XG4gICAgICAgIHJldHVybiBuZXcgWm9kT2JqZWN0KHtcbiAgICAgICAgICAgIC4uLnRoaXMuX2RlZixcbiAgICAgICAgICAgIHVua25vd25LZXlzOiBcInBhc3N0aHJvdWdoXCIsXG4gICAgICAgIH0pO1xuICAgIH1cbiAgICAvLyBjb25zdCBBdWdtZW50RmFjdG9yeSA9XG4gICAgLy8gICA8RGVmIGV4dGVuZHMgWm9kT2JqZWN0RGVmPihkZWY6IERlZikgPT5cbiAgICAvLyAgIDxBdWdtZW50YXRpb24gZXh0ZW5kcyBab2RSYXdTaGFwZT4oXG4gICAgLy8gICAgIGF1Z21lbnRhdGlvbjogQXVnbWVudGF0aW9uXG4gICAgLy8gICApOiBab2RPYmplY3Q8XG4gICAgLy8gICAgIGV4dGVuZFNoYXBlPFJldHVyblR5cGU8RGVmW1wic2hhcGVcIl0+LCBBdWdtZW50YXRpb24+LFxuICAgIC8vICAgICBEZWZbXCJ1bmtub3duS2V5c1wiXSxcbiAgICAvLyAgICAgRGVmW1wiY2F0Y2hhbGxcIl1cbiAgICAvLyAgID4gPT4ge1xuICAgIC8vICAgICByZXR1cm4gbmV3IFpvZE9iamVjdCh7XG4gICAgLy8gICAgICAgLi4uZGVmLFxuICAgIC8vICAgICAgIHNoYXBlOiAoKSA9PiAoe1xuICAgIC8vICAgICAgICAgLi4uZGVmLnNoYXBlKCksXG4gICAgLy8gICAgICAgICAuLi5hdWdtZW50YXRpb24sXG4gICAgLy8gICAgICAgfSksXG4gICAgLy8gICAgIH0pIGFzIGFueTtcbiAgICAvLyAgIH07XG4gICAgZXh0ZW5kKGF1Z21lbnRhdGlvbikge1xuICAgICAgICByZXR1cm4gbmV3IFpvZE9iamVjdCh7XG4gICAgICAgICAgICAuLi50aGlzLl9kZWYsXG4gICAgICAgICAgICBzaGFwZTogKCkgPT4gKHtcbiAgICAgICAgICAgICAgICAuLi50aGlzLl9kZWYuc2hhcGUoKSxcbiAgICAgICAgICAgICAgICAuLi5hdWdtZW50YXRpb24sXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFByaW9yIHRvIHpvZEAxLjAuMTIgdGhlcmUgd2FzIGEgYnVnIGluIHRoZVxuICAgICAqIGluZmVycmVkIHR5cGUgb2YgbWVyZ2VkIG9iamVjdHMuIFBsZWFzZVxuICAgICAqIHVwZ3JhZGUgaWYgeW91IGFyZSBleHBlcmllbmNpbmcgaXNzdWVzLlxuICAgICAqL1xuICAgIG1lcmdlKG1lcmdpbmcpIHtcbiAgICAgICAgY29uc3QgbWVyZ2VkID0gbmV3IFpvZE9iamVjdCh7XG4gICAgICAgICAgICB1bmtub3duS2V5czogbWVyZ2luZy5fZGVmLnVua25vd25LZXlzLFxuICAgICAgICAgICAgY2F0Y2hhbGw6IG1lcmdpbmcuX2RlZi5jYXRjaGFsbCxcbiAgICAgICAgICAgIHNoYXBlOiAoKSA9PiAoe1xuICAgICAgICAgICAgICAgIC4uLnRoaXMuX2RlZi5zaGFwZSgpLFxuICAgICAgICAgICAgICAgIC4uLm1lcmdpbmcuX2RlZi5zaGFwZSgpLFxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgICB0eXBlTmFtZTogWm9kRmlyc3RQYXJ0eVR5cGVLaW5kLlpvZE9iamVjdCxcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBtZXJnZWQ7XG4gICAgfVxuICAgIC8vIG1lcmdlPFxuICAgIC8vICAgSW5jb21pbmcgZXh0ZW5kcyBBbnlab2RPYmplY3QsXG4gICAgLy8gICBBdWdtZW50YXRpb24gZXh0ZW5kcyBJbmNvbWluZ1tcInNoYXBlXCJdLFxuICAgIC8vICAgTmV3T3V0cHV0IGV4dGVuZHMge1xuICAgIC8vICAgICBbayBpbiBrZXlvZiBBdWdtZW50YXRpb24gfCBrZXlvZiBPdXRwdXRdOiBrIGV4dGVuZHMga2V5b2YgQXVnbWVudGF0aW9uXG4gICAgLy8gICAgICAgPyBBdWdtZW50YXRpb25ba11bXCJfb3V0cHV0XCJdXG4gICAgLy8gICAgICAgOiBrIGV4dGVuZHMga2V5b2YgT3V0cHV0XG4gICAgLy8gICAgICAgPyBPdXRwdXRba11cbiAgICAvLyAgICAgICA6IG5ldmVyO1xuICAgIC8vICAgfSxcbiAgICAvLyAgIE5ld0lucHV0IGV4dGVuZHMge1xuICAgIC8vICAgICBbayBpbiBrZXlvZiBBdWdtZW50YXRpb24gfCBrZXlvZiBJbnB1dF06IGsgZXh0ZW5kcyBrZXlvZiBBdWdtZW50YXRpb25cbiAgICAvLyAgICAgICA/IEF1Z21lbnRhdGlvbltrXVtcIl9pbnB1dFwiXVxuICAgIC8vICAgICAgIDogayBleHRlbmRzIGtleW9mIElucHV0XG4gICAgLy8gICAgICAgPyBJbnB1dFtrXVxuICAgIC8vICAgICAgIDogbmV2ZXI7XG4gICAgLy8gICB9XG4gICAgLy8gPihcbiAgICAvLyAgIG1lcmdpbmc6IEluY29taW5nXG4gICAgLy8gKTogWm9kT2JqZWN0PFxuICAgIC8vICAgZXh0ZW5kU2hhcGU8VCwgUmV0dXJuVHlwZTxJbmNvbWluZ1tcIl9kZWZcIl1bXCJzaGFwZVwiXT4+LFxuICAgIC8vICAgSW5jb21pbmdbXCJfZGVmXCJdW1widW5rbm93bktleXNcIl0sXG4gICAgLy8gICBJbmNvbWluZ1tcIl9kZWZcIl1bXCJjYXRjaGFsbFwiXSxcbiAgICAvLyAgIE5ld091dHB1dCxcbiAgICAvLyAgIE5ld0lucHV0XG4gICAgLy8gPiB7XG4gICAgLy8gICBjb25zdCBtZXJnZWQ6IGFueSA9IG5ldyBab2RPYmplY3Qoe1xuICAgIC8vICAgICB1bmtub3duS2V5czogbWVyZ2luZy5fZGVmLnVua25vd25LZXlzLFxuICAgIC8vICAgICBjYXRjaGFsbDogbWVyZ2luZy5fZGVmLmNhdGNoYWxsLFxuICAgIC8vICAgICBzaGFwZTogKCkgPT5cbiAgICAvLyAgICAgICBvYmplY3RVdGlsLm1lcmdlU2hhcGVzKHRoaXMuX2RlZi5zaGFwZSgpLCBtZXJnaW5nLl9kZWYuc2hhcGUoKSksXG4gICAgLy8gICAgIHR5cGVOYW1lOiBab2RGaXJzdFBhcnR5VHlwZUtpbmQuWm9kT2JqZWN0LFxuICAgIC8vICAgfSkgYXMgYW55O1xuICAgIC8vICAgcmV0dXJuIG1lcmdlZDtcbiAgICAvLyB9XG4gICAgc2V0S2V5KGtleSwgc2NoZW1hKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmF1Z21lbnQoeyBba2V5XTogc2NoZW1hIH0pO1xuICAgIH1cbiAgICAvLyBtZXJnZTxJbmNvbWluZyBleHRlbmRzIEFueVpvZE9iamVjdD4oXG4gICAgLy8gICBtZXJnaW5nOiBJbmNvbWluZ1xuICAgIC8vICk6IC8vWm9kT2JqZWN0PFQgJiBJbmNvbWluZ1tcIl9zaGFwZVwiXSwgVW5rbm93bktleXMsIENhdGNoYWxsPiA9IChtZXJnaW5nKSA9PiB7XG4gICAgLy8gWm9kT2JqZWN0PFxuICAgIC8vICAgZXh0ZW5kU2hhcGU8VCwgUmV0dXJuVHlwZTxJbmNvbWluZ1tcIl9kZWZcIl1bXCJzaGFwZVwiXT4+LFxuICAgIC8vICAgSW5jb21pbmdbXCJfZGVmXCJdW1widW5rbm93bktleXNcIl0sXG4gICAgLy8gICBJbmNvbWluZ1tcIl9kZWZcIl1bXCJjYXRjaGFsbFwiXVxuICAgIC8vID4ge1xuICAgIC8vICAgLy8gY29uc3QgbWVyZ2VkU2hhcGUgPSBvYmplY3RVdGlsLm1lcmdlU2hhcGVzKFxuICAgIC8vICAgLy8gICB0aGlzLl9kZWYuc2hhcGUoKSxcbiAgICAvLyAgIC8vICAgbWVyZ2luZy5fZGVmLnNoYXBlKClcbiAgICAvLyAgIC8vICk7XG4gICAgLy8gICBjb25zdCBtZXJnZWQ6IGFueSA9IG5ldyBab2RPYmplY3Qoe1xuICAgIC8vICAgICB1bmtub3duS2V5czogbWVyZ2luZy5fZGVmLnVua25vd25LZXlzLFxuICAgIC8vICAgICBjYXRjaGFsbDogbWVyZ2luZy5fZGVmLmNhdGNoYWxsLFxuICAgIC8vICAgICBzaGFwZTogKCkgPT5cbiAgICAvLyAgICAgICBvYmplY3RVdGlsLm1lcmdlU2hhcGVzKHRoaXMuX2RlZi5zaGFwZSgpLCBtZXJnaW5nLl9kZWYuc2hhcGUoKSksXG4gICAgLy8gICAgIHR5cGVOYW1lOiBab2RGaXJzdFBhcnR5VHlwZUtpbmQuWm9kT2JqZWN0LFxuICAgIC8vICAgfSkgYXMgYW55O1xuICAgIC8vICAgcmV0dXJuIG1lcmdlZDtcbiAgICAvLyB9XG4gICAgY2F0Y2hhbGwoaW5kZXgpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBab2RPYmplY3Qoe1xuICAgICAgICAgICAgLi4udGhpcy5fZGVmLFxuICAgICAgICAgICAgY2F0Y2hhbGw6IGluZGV4LFxuICAgICAgICB9KTtcbiAgICB9XG4gICAgcGljayhtYXNrKSB7XG4gICAgICAgIGNvbnN0IHNoYXBlID0ge307XG4gICAgICAgIGZvciAoY29uc3Qga2V5IG9mIHV0aWwub2JqZWN0S2V5cyhtYXNrKSkge1xuICAgICAgICAgICAgaWYgKG1hc2tba2V5XSAmJiB0aGlzLnNoYXBlW2tleV0pIHtcbiAgICAgICAgICAgICAgICBzaGFwZVtrZXldID0gdGhpcy5zaGFwZVtrZXldO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBuZXcgWm9kT2JqZWN0KHtcbiAgICAgICAgICAgIC4uLnRoaXMuX2RlZixcbiAgICAgICAgICAgIHNoYXBlOiAoKSA9PiBzaGFwZSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIG9taXQobWFzaykge1xuICAgICAgICBjb25zdCBzaGFwZSA9IHt9O1xuICAgICAgICBmb3IgKGNvbnN0IGtleSBvZiB1dGlsLm9iamVjdEtleXModGhpcy5zaGFwZSkpIHtcbiAgICAgICAgICAgIGlmICghbWFza1trZXldKSB7XG4gICAgICAgICAgICAgICAgc2hhcGVba2V5XSA9IHRoaXMuc2hhcGVba2V5XTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbmV3IFpvZE9iamVjdCh7XG4gICAgICAgICAgICAuLi50aGlzLl9kZWYsXG4gICAgICAgICAgICBzaGFwZTogKCkgPT4gc2hhcGUsXG4gICAgICAgIH0pO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBAZGVwcmVjYXRlZFxuICAgICAqL1xuICAgIGRlZXBQYXJ0aWFsKCkge1xuICAgICAgICByZXR1cm4gZGVlcFBhcnRpYWxpZnkodGhpcyk7XG4gICAgfVxuICAgIHBhcnRpYWwobWFzaykge1xuICAgICAgICBjb25zdCBuZXdTaGFwZSA9IHt9O1xuICAgICAgICBmb3IgKGNvbnN0IGtleSBvZiB1dGlsLm9iamVjdEtleXModGhpcy5zaGFwZSkpIHtcbiAgICAgICAgICAgIGNvbnN0IGZpZWxkU2NoZW1hID0gdGhpcy5zaGFwZVtrZXldO1xuICAgICAgICAgICAgaWYgKG1hc2sgJiYgIW1hc2tba2V5XSkge1xuICAgICAgICAgICAgICAgIG5ld1NoYXBlW2tleV0gPSBmaWVsZFNjaGVtYTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIG5ld1NoYXBlW2tleV0gPSBmaWVsZFNjaGVtYS5vcHRpb25hbCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBuZXcgWm9kT2JqZWN0KHtcbiAgICAgICAgICAgIC4uLnRoaXMuX2RlZixcbiAgICAgICAgICAgIHNoYXBlOiAoKSA9PiBuZXdTaGFwZSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHJlcXVpcmVkKG1hc2spIHtcbiAgICAgICAgY29uc3QgbmV3U2hhcGUgPSB7fTtcbiAgICAgICAgZm9yIChjb25zdCBrZXkgb2YgdXRpbC5vYmplY3RLZXlzKHRoaXMuc2hhcGUpKSB7XG4gICAgICAgICAgICBpZiAobWFzayAmJiAhbWFza1trZXldKSB7XG4gICAgICAgICAgICAgICAgbmV3U2hhcGVba2V5XSA9IHRoaXMuc2hhcGVba2V5XTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIGNvbnN0IGZpZWxkU2NoZW1hID0gdGhpcy5zaGFwZVtrZXldO1xuICAgICAgICAgICAgICAgIGxldCBuZXdGaWVsZCA9IGZpZWxkU2NoZW1hO1xuICAgICAgICAgICAgICAgIHdoaWxlIChuZXdGaWVsZCBpbnN0YW5jZW9mIFpvZE9wdGlvbmFsKSB7XG4gICAgICAgICAgICAgICAgICAgIG5ld0ZpZWxkID0gbmV3RmllbGQuX2RlZi5pbm5lclR5cGU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG5ld1NoYXBlW2tleV0gPSBuZXdGaWVsZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbmV3IFpvZE9iamVjdCh7XG4gICAgICAgICAgICAuLi50aGlzLl9kZWYsXG4gICAgICAgICAgICBzaGFwZTogKCkgPT4gbmV3U2hhcGUsXG4gICAgICAgIH0pO1xuICAgIH1cbiAgICBrZXlvZigpIHtcbiAgICAgICAgcmV0dXJuIGNyZWF0ZVpvZEVudW0odXRpbC5vYmplY3RLZXlzKHRoaXMuc2hhcGUpKTtcbiAgICB9XG59XG5ab2RPYmplY3QuY3JlYXRlID0gKHNoYXBlLCBwYXJhbXMpID0+IHtcbiAgICByZXR1cm4gbmV3IFpvZE9iamVjdCh7XG4gICAgICAgIHNoYXBlOiAoKSA9PiBzaGFwZSxcbiAgICAgICAgdW5rbm93bktleXM6IFwic3RyaXBcIixcbiAgICAgICAgY2F0Y2hhbGw6IFpvZE5ldmVyLmNyZWF0ZSgpLFxuICAgICAgICB0eXBlTmFtZTogWm9kRmlyc3RQYXJ0eVR5cGVLaW5kLlpvZE9iamVjdCxcbiAgICAgICAgLi4ucHJvY2Vzc0NyZWF0ZVBhcmFtcyhwYXJhbXMpLFxuICAgIH0pO1xufTtcblpvZE9iamVjdC5zdHJpY3RDcmVhdGUgPSAoc2hhcGUsIHBhcmFtcykgPT4ge1xuICAgIHJldHVybiBuZXcgWm9kT2JqZWN0KHtcbiAgICAgICAgc2hhcGU6ICgpID0+IHNoYXBlLFxuICAgICAgICB1bmtub3duS2V5czogXCJzdHJpY3RcIixcbiAgICAgICAgY2F0Y2hhbGw6IFpvZE5ldmVyLmNyZWF0ZSgpLFxuICAgICAgICB0eXBlTmFtZTogWm9kRmlyc3RQYXJ0eVR5cGVLaW5kLlpvZE9iamVjdCxcbiAgICAgICAgLi4ucHJvY2Vzc0NyZWF0ZVBhcmFtcyhwYXJhbXMpLFxuICAgIH0pO1xufTtcblpvZE9iamVjdC5sYXp5Y3JlYXRlID0gKHNoYXBlLCBwYXJhbXMpID0+IHtcbiAgICByZXR1cm4gbmV3IFpvZE9iamVjdCh7XG4gICAgICAgIHNoYXBlLFxuICAgICAgICB1bmtub3duS2V5czogXCJzdHJpcFwiLFxuICAgICAgICBjYXRjaGFsbDogWm9kTmV2ZXIuY3JlYXRlKCksXG4gICAgICAgIHR5cGVOYW1lOiBab2RGaXJzdFBhcnR5VHlwZUtpbmQuWm9kT2JqZWN0LFxuICAgICAgICAuLi5wcm9jZXNzQ3JlYXRlUGFyYW1zKHBhcmFtcyksXG4gICAgfSk7XG59O1xuZXhwb3J0IGNsYXNzIFpvZFVuaW9uIGV4dGVuZHMgWm9kVHlwZSB7XG4gICAgX3BhcnNlKGlucHV0KSB7XG4gICAgICAgIGNvbnN0IHsgY3R4IH0gPSB0aGlzLl9wcm9jZXNzSW5wdXRQYXJhbXMoaW5wdXQpO1xuICAgICAgICBjb25zdCBvcHRpb25zID0gdGhpcy5fZGVmLm9wdGlvbnM7XG4gICAgICAgIGZ1bmN0aW9uIGhhbmRsZVJlc3VsdHMocmVzdWx0cykge1xuICAgICAgICAgICAgLy8gcmV0dXJuIGZpcnN0IGlzc3VlLWZyZWUgdmFsaWRhdGlvbiBpZiBpdCBleGlzdHNcbiAgICAgICAgICAgIGZvciAoY29uc3QgcmVzdWx0IG9mIHJlc3VsdHMpIHtcbiAgICAgICAgICAgICAgICBpZiAocmVzdWx0LnJlc3VsdC5zdGF0dXMgPT09IFwidmFsaWRcIikge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gcmVzdWx0LnJlc3VsdDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHJlc3VsdCBvZiByZXN1bHRzKSB7XG4gICAgICAgICAgICAgICAgaWYgKHJlc3VsdC5yZXN1bHQuc3RhdHVzID09PSBcImRpcnR5XCIpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gYWRkIGlzc3VlcyBmcm9tIGRpcnR5IG9wdGlvblxuICAgICAgICAgICAgICAgICAgICBjdHguY29tbW9uLmlzc3Vlcy5wdXNoKC4uLnJlc3VsdC5jdHguY29tbW9uLmlzc3Vlcyk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiByZXN1bHQucmVzdWx0O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIHJldHVybiBpbnZhbGlkXG4gICAgICAgICAgICBjb25zdCB1bmlvbkVycm9ycyA9IHJlc3VsdHMubWFwKChyZXN1bHQpID0+IG5ldyBab2RFcnJvcihyZXN1bHQuY3R4LmNvbW1vbi5pc3N1ZXMpKTtcbiAgICAgICAgICAgIGFkZElzc3VlVG9Db250ZXh0KGN0eCwge1xuICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS5pbnZhbGlkX3VuaW9uLFxuICAgICAgICAgICAgICAgIHVuaW9uRXJyb3JzLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gSU5WQUxJRDtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY3R4LmNvbW1vbi5hc3luYykge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKG9wdGlvbnMubWFwKGFzeW5jIChvcHRpb24pID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBjaGlsZEN0eCA9IHtcbiAgICAgICAgICAgICAgICAgICAgLi4uY3R4LFxuICAgICAgICAgICAgICAgICAgICBjb21tb246IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLmN0eC5jb21tb24sXG4gICAgICAgICAgICAgICAgICAgICAgICBpc3N1ZXM6IFtdLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBwYXJlbnQ6IG51bGwsXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICByZXN1bHQ6IGF3YWl0IG9wdGlvbi5fcGFyc2VBc3luYyh7XG4gICAgICAgICAgICAgICAgICAgICAgICBkYXRhOiBjdHguZGF0YSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhdGg6IGN0eC5wYXRoLFxuICAgICAgICAgICAgICAgICAgICAgICAgcGFyZW50OiBjaGlsZEN0eCxcbiAgICAgICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgICAgIGN0eDogY2hpbGRDdHgsXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0pKS50aGVuKGhhbmRsZVJlc3VsdHMpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgbGV0IGRpcnR5ID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgY29uc3QgaXNzdWVzID0gW107XG4gICAgICAgICAgICBmb3IgKGNvbnN0IG9wdGlvbiBvZiBvcHRpb25zKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgY2hpbGRDdHggPSB7XG4gICAgICAgICAgICAgICAgICAgIC4uLmN0eCxcbiAgICAgICAgICAgICAgICAgICAgY29tbW9uOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAuLi5jdHguY29tbW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgaXNzdWVzOiBbXSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgcGFyZW50OiBudWxsLFxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gb3B0aW9uLl9wYXJzZVN5bmMoe1xuICAgICAgICAgICAgICAgICAgICBkYXRhOiBjdHguZGF0YSxcbiAgICAgICAgICAgICAgICAgICAgcGF0aDogY3R4LnBhdGgsXG4gICAgICAgICAgICAgICAgICAgIHBhcmVudDogY2hpbGRDdHgsXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgaWYgKHJlc3VsdC5zdGF0dXMgPT09IFwidmFsaWRcIikge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIGlmIChyZXN1bHQuc3RhdHVzID09PSBcImRpcnR5XCIgJiYgIWRpcnR5KSB7XG4gICAgICAgICAgICAgICAgICAgIGRpcnR5ID0geyByZXN1bHQsIGN0eDogY2hpbGRDdHggfTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKGNoaWxkQ3R4LmNvbW1vbi5pc3N1ZXMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgICAgIGlzc3Vlcy5wdXNoKGNoaWxkQ3R4LmNvbW1vbi5pc3N1ZXMpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChkaXJ0eSkge1xuICAgICAgICAgICAgICAgIGN0eC5jb21tb24uaXNzdWVzLnB1c2goLi4uZGlydHkuY3R4LmNvbW1vbi5pc3N1ZXMpO1xuICAgICAgICAgICAgICAgIHJldHVybiBkaXJ0eS5yZXN1bHQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCB1bmlvbkVycm9ycyA9IGlzc3Vlcy5tYXAoKGlzc3VlcykgPT4gbmV3IFpvZEVycm9yKGlzc3VlcykpO1xuICAgICAgICAgICAgYWRkSXNzdWVUb0NvbnRleHQoY3R4LCB7XG4gICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLmludmFsaWRfdW5pb24sXG4gICAgICAgICAgICAgICAgdW5pb25FcnJvcnMsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiBJTlZBTElEO1xuICAgICAgICB9XG4gICAgfVxuICAgIGdldCBvcHRpb25zKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fZGVmLm9wdGlvbnM7XG4gICAgfVxufVxuWm9kVW5pb24uY3JlYXRlID0gKHR5cGVzLCBwYXJhbXMpID0+IHtcbiAgICByZXR1cm4gbmV3IFpvZFVuaW9uKHtcbiAgICAgICAgb3B0aW9uczogdHlwZXMsXG4gICAgICAgIHR5cGVOYW1lOiBab2RGaXJzdFBhcnR5VHlwZUtpbmQuWm9kVW5pb24sXG4gICAgICAgIC4uLnByb2Nlc3NDcmVhdGVQYXJhbXMocGFyYW1zKSxcbiAgICB9KTtcbn07XG4vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vL1xuLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cbi8vLy8vLy8vLy8gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLy8vLy8vLy8vXG4vLy8vLy8vLy8vICAgICAgWm9kRGlzY3JpbWluYXRlZFVuaW9uICAgICAgLy8vLy8vLy8vL1xuLy8vLy8vLy8vLyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vLy8vLy8vLy9cbi8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vXG4vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vL1xuY29uc3QgZ2V0RGlzY3JpbWluYXRvciA9ICh0eXBlKSA9PiB7XG4gICAgaWYgKHR5cGUgaW5zdGFuY2VvZiBab2RMYXp5KSB7XG4gICAgICAgIHJldHVybiBnZXREaXNjcmltaW5hdG9yKHR5cGUuc2NoZW1hKTtcbiAgICB9XG4gICAgZWxzZSBpZiAodHlwZSBpbnN0YW5jZW9mIFpvZEVmZmVjdHMpIHtcbiAgICAgICAgcmV0dXJuIGdldERpc2NyaW1pbmF0b3IodHlwZS5pbm5lclR5cGUoKSk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHR5cGUgaW5zdGFuY2VvZiBab2RMaXRlcmFsKSB7XG4gICAgICAgIHJldHVybiBbdHlwZS52YWx1ZV07XG4gICAgfVxuICAgIGVsc2UgaWYgKHR5cGUgaW5zdGFuY2VvZiBab2RFbnVtKSB7XG4gICAgICAgIHJldHVybiB0eXBlLm9wdGlvbnM7XG4gICAgfVxuICAgIGVsc2UgaWYgKHR5cGUgaW5zdGFuY2VvZiBab2ROYXRpdmVFbnVtKSB7XG4gICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBiYW4vYmFuXG4gICAgICAgIHJldHVybiB1dGlsLm9iamVjdFZhbHVlcyh0eXBlLmVudW0pO1xuICAgIH1cbiAgICBlbHNlIGlmICh0eXBlIGluc3RhbmNlb2YgWm9kRGVmYXVsdCkge1xuICAgICAgICByZXR1cm4gZ2V0RGlzY3JpbWluYXRvcih0eXBlLl9kZWYuaW5uZXJUeXBlKTtcbiAgICB9XG4gICAgZWxzZSBpZiAodHlwZSBpbnN0YW5jZW9mIFpvZFVuZGVmaW5lZCkge1xuICAgICAgICByZXR1cm4gW3VuZGVmaW5lZF07XG4gICAgfVxuICAgIGVsc2UgaWYgKHR5cGUgaW5zdGFuY2VvZiBab2ROdWxsKSB7XG4gICAgICAgIHJldHVybiBbbnVsbF07XG4gICAgfVxuICAgIGVsc2UgaWYgKHR5cGUgaW5zdGFuY2VvZiBab2RPcHRpb25hbCkge1xuICAgICAgICByZXR1cm4gW3VuZGVmaW5lZCwgLi4uZ2V0RGlzY3JpbWluYXRvcih0eXBlLnVud3JhcCgpKV07XG4gICAgfVxuICAgIGVsc2UgaWYgKHR5cGUgaW5zdGFuY2VvZiBab2ROdWxsYWJsZSkge1xuICAgICAgICByZXR1cm4gW251bGwsIC4uLmdldERpc2NyaW1pbmF0b3IodHlwZS51bndyYXAoKSldO1xuICAgIH1cbiAgICBlbHNlIGlmICh0eXBlIGluc3RhbmNlb2YgWm9kQnJhbmRlZCkge1xuICAgICAgICByZXR1cm4gZ2V0RGlzY3JpbWluYXRvcih0eXBlLnVud3JhcCgpKTtcbiAgICB9XG4gICAgZWxzZSBpZiAodHlwZSBpbnN0YW5jZW9mIFpvZFJlYWRvbmx5KSB7XG4gICAgICAgIHJldHVybiBnZXREaXNjcmltaW5hdG9yKHR5cGUudW53cmFwKCkpO1xuICAgIH1cbiAgICBlbHNlIGlmICh0eXBlIGluc3RhbmNlb2YgWm9kQ2F0Y2gpIHtcbiAgICAgICAgcmV0dXJuIGdldERpc2NyaW1pbmF0b3IodHlwZS5fZGVmLmlubmVyVHlwZSk7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgICByZXR1cm4gW107XG4gICAgfVxufTtcbmV4cG9ydCBjbGFzcyBab2REaXNjcmltaW5hdGVkVW5pb24gZXh0ZW5kcyBab2RUeXBlIHtcbiAgICBfcGFyc2UoaW5wdXQpIHtcbiAgICAgICAgY29uc3QgeyBjdHggfSA9IHRoaXMuX3Byb2Nlc3NJbnB1dFBhcmFtcyhpbnB1dCk7XG4gICAgICAgIGlmIChjdHgucGFyc2VkVHlwZSAhPT0gWm9kUGFyc2VkVHlwZS5vYmplY3QpIHtcbiAgICAgICAgICAgIGFkZElzc3VlVG9Db250ZXh0KGN0eCwge1xuICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS5pbnZhbGlkX3R5cGUsXG4gICAgICAgICAgICAgICAgZXhwZWN0ZWQ6IFpvZFBhcnNlZFR5cGUub2JqZWN0LFxuICAgICAgICAgICAgICAgIHJlY2VpdmVkOiBjdHgucGFyc2VkVHlwZSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIElOVkFMSUQ7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgZGlzY3JpbWluYXRvciA9IHRoaXMuZGlzY3JpbWluYXRvcjtcbiAgICAgICAgY29uc3QgZGlzY3JpbWluYXRvclZhbHVlID0gY3R4LmRhdGFbZGlzY3JpbWluYXRvcl07XG4gICAgICAgIGNvbnN0IG9wdGlvbiA9IHRoaXMub3B0aW9uc01hcC5nZXQoZGlzY3JpbWluYXRvclZhbHVlKTtcbiAgICAgICAgaWYgKCFvcHRpb24pIHtcbiAgICAgICAgICAgIGFkZElzc3VlVG9Db250ZXh0KGN0eCwge1xuICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS5pbnZhbGlkX3VuaW9uX2Rpc2NyaW1pbmF0b3IsXG4gICAgICAgICAgICAgICAgb3B0aW9uczogQXJyYXkuZnJvbSh0aGlzLm9wdGlvbnNNYXAua2V5cygpKSxcbiAgICAgICAgICAgICAgICBwYXRoOiBbZGlzY3JpbWluYXRvcl0sXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiBJTlZBTElEO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjdHguY29tbW9uLmFzeW5jKSB7XG4gICAgICAgICAgICByZXR1cm4gb3B0aW9uLl9wYXJzZUFzeW5jKHtcbiAgICAgICAgICAgICAgICBkYXRhOiBjdHguZGF0YSxcbiAgICAgICAgICAgICAgICBwYXRoOiBjdHgucGF0aCxcbiAgICAgICAgICAgICAgICBwYXJlbnQ6IGN0eCxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIG9wdGlvbi5fcGFyc2VTeW5jKHtcbiAgICAgICAgICAgICAgICBkYXRhOiBjdHguZGF0YSxcbiAgICAgICAgICAgICAgICBwYXRoOiBjdHgucGF0aCxcbiAgICAgICAgICAgICAgICBwYXJlbnQ6IGN0eCxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuICAgIGdldCBkaXNjcmltaW5hdG9yKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fZGVmLmRpc2NyaW1pbmF0b3I7XG4gICAgfVxuICAgIGdldCBvcHRpb25zKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fZGVmLm9wdGlvbnM7XG4gICAgfVxuICAgIGdldCBvcHRpb25zTWFwKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fZGVmLm9wdGlvbnNNYXA7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFRoZSBjb25zdHJ1Y3RvciBvZiB0aGUgZGlzY3JpbWluYXRlZCB1bmlvbiBzY2hlbWEuIEl0cyBiZWhhdmlvdXIgaXMgdmVyeSBzaW1pbGFyIHRvIHRoYXQgb2YgdGhlIG5vcm1hbCB6LnVuaW9uKCkgY29uc3RydWN0b3IuXG4gICAgICogSG93ZXZlciwgaXQgb25seSBhbGxvd3MgYSB1bmlvbiBvZiBvYmplY3RzLCBhbGwgb2Ygd2hpY2ggbmVlZCB0byBzaGFyZSBhIGRpc2NyaW1pbmF0b3IgcHJvcGVydHkuIFRoaXMgcHJvcGVydHkgbXVzdFxuICAgICAqIGhhdmUgYSBkaWZmZXJlbnQgdmFsdWUgZm9yIGVhY2ggb2JqZWN0IGluIHRoZSB1bmlvbi5cbiAgICAgKiBAcGFyYW0gZGlzY3JpbWluYXRvciB0aGUgbmFtZSBvZiB0aGUgZGlzY3JpbWluYXRvciBwcm9wZXJ0eVxuICAgICAqIEBwYXJhbSB0eXBlcyBhbiBhcnJheSBvZiBvYmplY3Qgc2NoZW1hc1xuICAgICAqIEBwYXJhbSBwYXJhbXNcbiAgICAgKi9cbiAgICBzdGF0aWMgY3JlYXRlKGRpc2NyaW1pbmF0b3IsIG9wdGlvbnMsIHBhcmFtcykge1xuICAgICAgICAvLyBHZXQgYWxsIHRoZSB2YWxpZCBkaXNjcmltaW5hdG9yIHZhbHVlc1xuICAgICAgICBjb25zdCBvcHRpb25zTWFwID0gbmV3IE1hcCgpO1xuICAgICAgICAvLyB0cnkge1xuICAgICAgICBmb3IgKGNvbnN0IHR5cGUgb2Ygb3B0aW9ucykge1xuICAgICAgICAgICAgY29uc3QgZGlzY3JpbWluYXRvclZhbHVlcyA9IGdldERpc2NyaW1pbmF0b3IodHlwZS5zaGFwZVtkaXNjcmltaW5hdG9yXSk7XG4gICAgICAgICAgICBpZiAoIWRpc2NyaW1pbmF0b3JWYWx1ZXMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBBIGRpc2NyaW1pbmF0b3IgdmFsdWUgZm9yIGtleSBcXGAke2Rpc2NyaW1pbmF0b3J9XFxgIGNvdWxkIG5vdCBiZSBleHRyYWN0ZWQgZnJvbSBhbGwgc2NoZW1hIG9wdGlvbnNgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGZvciAoY29uc3QgdmFsdWUgb2YgZGlzY3JpbWluYXRvclZhbHVlcykge1xuICAgICAgICAgICAgICAgIGlmIChvcHRpb25zTWFwLmhhcyh2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBEaXNjcmltaW5hdG9yIHByb3BlcnR5ICR7U3RyaW5nKGRpc2NyaW1pbmF0b3IpfSBoYXMgZHVwbGljYXRlIHZhbHVlICR7U3RyaW5nKHZhbHVlKX1gKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgb3B0aW9uc01hcC5zZXQodmFsdWUsIHR5cGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBuZXcgWm9kRGlzY3JpbWluYXRlZFVuaW9uKHtcbiAgICAgICAgICAgIHR5cGVOYW1lOiBab2RGaXJzdFBhcnR5VHlwZUtpbmQuWm9kRGlzY3JpbWluYXRlZFVuaW9uLFxuICAgICAgICAgICAgZGlzY3JpbWluYXRvcixcbiAgICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgICBvcHRpb25zTWFwLFxuICAgICAgICAgICAgLi4ucHJvY2Vzc0NyZWF0ZVBhcmFtcyhwYXJhbXMpLFxuICAgICAgICB9KTtcbiAgICB9XG59XG5mdW5jdGlvbiBtZXJnZVZhbHVlcyhhLCBiKSB7XG4gICAgY29uc3QgYVR5cGUgPSBnZXRQYXJzZWRUeXBlKGEpO1xuICAgIGNvbnN0IGJUeXBlID0gZ2V0UGFyc2VkVHlwZShiKTtcbiAgICBpZiAoYSA9PT0gYikge1xuICAgICAgICByZXR1cm4geyB2YWxpZDogdHJ1ZSwgZGF0YTogYSB9O1xuICAgIH1cbiAgICBlbHNlIGlmIChhVHlwZSA9PT0gWm9kUGFyc2VkVHlwZS5vYmplY3QgJiYgYlR5cGUgPT09IFpvZFBhcnNlZFR5cGUub2JqZWN0KSB7XG4gICAgICAgIGNvbnN0IGJLZXlzID0gdXRpbC5vYmplY3RLZXlzKGIpO1xuICAgICAgICBjb25zdCBzaGFyZWRLZXlzID0gdXRpbC5vYmplY3RLZXlzKGEpLmZpbHRlcigoa2V5KSA9PiBiS2V5cy5pbmRleE9mKGtleSkgIT09IC0xKTtcbiAgICAgICAgY29uc3QgbmV3T2JqID0geyAuLi5hLCAuLi5iIH07XG4gICAgICAgIGZvciAoY29uc3Qga2V5IG9mIHNoYXJlZEtleXMpIHtcbiAgICAgICAgICAgIGNvbnN0IHNoYXJlZFZhbHVlID0gbWVyZ2VWYWx1ZXMoYVtrZXldLCBiW2tleV0pO1xuICAgICAgICAgICAgaWYgKCFzaGFyZWRWYWx1ZS52YWxpZCkge1xuICAgICAgICAgICAgICAgIHJldHVybiB7IHZhbGlkOiBmYWxzZSB9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbmV3T2JqW2tleV0gPSBzaGFyZWRWYWx1ZS5kYXRhO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB7IHZhbGlkOiB0cnVlLCBkYXRhOiBuZXdPYmogfTtcbiAgICB9XG4gICAgZWxzZSBpZiAoYVR5cGUgPT09IFpvZFBhcnNlZFR5cGUuYXJyYXkgJiYgYlR5cGUgPT09IFpvZFBhcnNlZFR5cGUuYXJyYXkpIHtcbiAgICAgICAgaWYgKGEubGVuZ3RoICE9PSBiLmxlbmd0aCkge1xuICAgICAgICAgICAgcmV0dXJuIHsgdmFsaWQ6IGZhbHNlIH07XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgbmV3QXJyYXkgPSBbXTtcbiAgICAgICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGEubGVuZ3RoOyBpbmRleCsrKSB7XG4gICAgICAgICAgICBjb25zdCBpdGVtQSA9IGFbaW5kZXhdO1xuICAgICAgICAgICAgY29uc3QgaXRlbUIgPSBiW2luZGV4XTtcbiAgICAgICAgICAgIGNvbnN0IHNoYXJlZFZhbHVlID0gbWVyZ2VWYWx1ZXMoaXRlbUEsIGl0ZW1CKTtcbiAgICAgICAgICAgIGlmICghc2hhcmVkVmFsdWUudmFsaWQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4geyB2YWxpZDogZmFsc2UgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG5ld0FycmF5LnB1c2goc2hhcmVkVmFsdWUuZGF0YSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHsgdmFsaWQ6IHRydWUsIGRhdGE6IG5ld0FycmF5IH07XG4gICAgfVxuICAgIGVsc2UgaWYgKGFUeXBlID09PSBab2RQYXJzZWRUeXBlLmRhdGUgJiYgYlR5cGUgPT09IFpvZFBhcnNlZFR5cGUuZGF0ZSAmJiArYSA9PT0gK2IpIHtcbiAgICAgICAgcmV0dXJuIHsgdmFsaWQ6IHRydWUsIGRhdGE6IGEgfTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIHJldHVybiB7IHZhbGlkOiBmYWxzZSB9O1xuICAgIH1cbn1cbmV4cG9ydCBjbGFzcyBab2RJbnRlcnNlY3Rpb24gZXh0ZW5kcyBab2RUeXBlIHtcbiAgICBfcGFyc2UoaW5wdXQpIHtcbiAgICAgICAgY29uc3QgeyBzdGF0dXMsIGN0eCB9ID0gdGhpcy5fcHJvY2Vzc0lucHV0UGFyYW1zKGlucHV0KTtcbiAgICAgICAgY29uc3QgaGFuZGxlUGFyc2VkID0gKHBhcnNlZExlZnQsIHBhcnNlZFJpZ2h0KSA9PiB7XG4gICAgICAgICAgICBpZiAoaXNBYm9ydGVkKHBhcnNlZExlZnQpIHx8IGlzQWJvcnRlZChwYXJzZWRSaWdodCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gSU5WQUxJRDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IG1lcmdlZCA9IG1lcmdlVmFsdWVzKHBhcnNlZExlZnQudmFsdWUsIHBhcnNlZFJpZ2h0LnZhbHVlKTtcbiAgICAgICAgICAgIGlmICghbWVyZ2VkLnZhbGlkKSB7XG4gICAgICAgICAgICAgICAgYWRkSXNzdWVUb0NvbnRleHQoY3R4LCB7XG4gICAgICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS5pbnZhbGlkX2ludGVyc2VjdGlvbl90eXBlcyxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICByZXR1cm4gSU5WQUxJRDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChpc0RpcnR5KHBhcnNlZExlZnQpIHx8IGlzRGlydHkocGFyc2VkUmlnaHQpKSB7XG4gICAgICAgICAgICAgICAgc3RhdHVzLmRpcnR5KCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4geyBzdGF0dXM6IHN0YXR1cy52YWx1ZSwgdmFsdWU6IG1lcmdlZC5kYXRhIH07XG4gICAgICAgIH07XG4gICAgICAgIGlmIChjdHguY29tbW9uLmFzeW5jKSB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwoW1xuICAgICAgICAgICAgICAgIHRoaXMuX2RlZi5sZWZ0Ll9wYXJzZUFzeW5jKHtcbiAgICAgICAgICAgICAgICAgICAgZGF0YTogY3R4LmRhdGEsXG4gICAgICAgICAgICAgICAgICAgIHBhdGg6IGN0eC5wYXRoLFxuICAgICAgICAgICAgICAgICAgICBwYXJlbnQ6IGN0eCxcbiAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgICB0aGlzLl9kZWYucmlnaHQuX3BhcnNlQXN5bmMoe1xuICAgICAgICAgICAgICAgICAgICBkYXRhOiBjdHguZGF0YSxcbiAgICAgICAgICAgICAgICAgICAgcGF0aDogY3R4LnBhdGgsXG4gICAgICAgICAgICAgICAgICAgIHBhcmVudDogY3R4LFxuICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgXSkudGhlbigoW2xlZnQsIHJpZ2h0XSkgPT4gaGFuZGxlUGFyc2VkKGxlZnQsIHJpZ2h0KSk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gaGFuZGxlUGFyc2VkKHRoaXMuX2RlZi5sZWZ0Ll9wYXJzZVN5bmMoe1xuICAgICAgICAgICAgICAgIGRhdGE6IGN0eC5kYXRhLFxuICAgICAgICAgICAgICAgIHBhdGg6IGN0eC5wYXRoLFxuICAgICAgICAgICAgICAgIHBhcmVudDogY3R4LFxuICAgICAgICAgICAgfSksIHRoaXMuX2RlZi5yaWdodC5fcGFyc2VTeW5jKHtcbiAgICAgICAgICAgICAgICBkYXRhOiBjdHguZGF0YSxcbiAgICAgICAgICAgICAgICBwYXRoOiBjdHgucGF0aCxcbiAgICAgICAgICAgICAgICBwYXJlbnQ6IGN0eCxcbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblpvZEludGVyc2VjdGlvbi5jcmVhdGUgPSAobGVmdCwgcmlnaHQsIHBhcmFtcykgPT4ge1xuICAgIHJldHVybiBuZXcgWm9kSW50ZXJzZWN0aW9uKHtcbiAgICAgICAgbGVmdDogbGVmdCxcbiAgICAgICAgcmlnaHQ6IHJpZ2h0LFxuICAgICAgICB0eXBlTmFtZTogWm9kRmlyc3RQYXJ0eVR5cGVLaW5kLlpvZEludGVyc2VjdGlvbixcbiAgICAgICAgLi4ucHJvY2Vzc0NyZWF0ZVBhcmFtcyhwYXJhbXMpLFxuICAgIH0pO1xufTtcbi8vIHR5cGUgWm9kVHVwbGVJdGVtcyA9IFtab2RUeXBlQW55LCAuLi5ab2RUeXBlQW55W11dO1xuZXhwb3J0IGNsYXNzIFpvZFR1cGxlIGV4dGVuZHMgWm9kVHlwZSB7XG4gICAgX3BhcnNlKGlucHV0KSB7XG4gICAgICAgIGNvbnN0IHsgc3RhdHVzLCBjdHggfSA9IHRoaXMuX3Byb2Nlc3NJbnB1dFBhcmFtcyhpbnB1dCk7XG4gICAgICAgIGlmIChjdHgucGFyc2VkVHlwZSAhPT0gWm9kUGFyc2VkVHlwZS5hcnJheSkge1xuICAgICAgICAgICAgYWRkSXNzdWVUb0NvbnRleHQoY3R4LCB7XG4gICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLmludmFsaWRfdHlwZSxcbiAgICAgICAgICAgICAgICBleHBlY3RlZDogWm9kUGFyc2VkVHlwZS5hcnJheSxcbiAgICAgICAgICAgICAgICByZWNlaXZlZDogY3R4LnBhcnNlZFR5cGUsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiBJTlZBTElEO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjdHguZGF0YS5sZW5ndGggPCB0aGlzLl9kZWYuaXRlbXMubGVuZ3RoKSB7XG4gICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICBjb2RlOiBab2RJc3N1ZUNvZGUudG9vX3NtYWxsLFxuICAgICAgICAgICAgICAgIG1pbmltdW06IHRoaXMuX2RlZi5pdGVtcy5sZW5ndGgsXG4gICAgICAgICAgICAgICAgaW5jbHVzaXZlOiB0cnVlLFxuICAgICAgICAgICAgICAgIGV4YWN0OiBmYWxzZSxcbiAgICAgICAgICAgICAgICB0eXBlOiBcImFycmF5XCIsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiBJTlZBTElEO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHJlc3QgPSB0aGlzLl9kZWYucmVzdDtcbiAgICAgICAgaWYgKCFyZXN0ICYmIGN0eC5kYXRhLmxlbmd0aCA+IHRoaXMuX2RlZi5pdGVtcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGFkZElzc3VlVG9Db250ZXh0KGN0eCwge1xuICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS50b29fYmlnLFxuICAgICAgICAgICAgICAgIG1heGltdW06IHRoaXMuX2RlZi5pdGVtcy5sZW5ndGgsXG4gICAgICAgICAgICAgICAgaW5jbHVzaXZlOiB0cnVlLFxuICAgICAgICAgICAgICAgIGV4YWN0OiBmYWxzZSxcbiAgICAgICAgICAgICAgICB0eXBlOiBcImFycmF5XCIsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHN0YXR1cy5kaXJ0eSgpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGl0ZW1zID0gWy4uLmN0eC5kYXRhXVxuICAgICAgICAgICAgLm1hcCgoaXRlbSwgaXRlbUluZGV4KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLl9kZWYuaXRlbXNbaXRlbUluZGV4XSB8fCB0aGlzLl9kZWYucmVzdDtcbiAgICAgICAgICAgIGlmICghc2NoZW1hKVxuICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgcmV0dXJuIHNjaGVtYS5fcGFyc2UobmV3IFBhcnNlSW5wdXRMYXp5UGF0aChjdHgsIGl0ZW0sIGN0eC5wYXRoLCBpdGVtSW5kZXgpKTtcbiAgICAgICAgfSlcbiAgICAgICAgICAgIC5maWx0ZXIoKHgpID0+ICEheCk7IC8vIGZpbHRlciBudWxsc1xuICAgICAgICBpZiAoY3R4LmNvbW1vbi5hc3luYykge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKGl0ZW1zKS50aGVuKChyZXN1bHRzKSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFBhcnNlU3RhdHVzLm1lcmdlQXJyYXkoc3RhdHVzLCByZXN1bHRzKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIFBhcnNlU3RhdHVzLm1lcmdlQXJyYXkoc3RhdHVzLCBpdGVtcyk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgZ2V0IGl0ZW1zKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fZGVmLml0ZW1zO1xuICAgIH1cbiAgICByZXN0KHJlc3QpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBab2RUdXBsZSh7XG4gICAgICAgICAgICAuLi50aGlzLl9kZWYsXG4gICAgICAgICAgICByZXN0LFxuICAgICAgICB9KTtcbiAgICB9XG59XG5ab2RUdXBsZS5jcmVhdGUgPSAoc2NoZW1hcywgcGFyYW1zKSA9PiB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHNjaGVtYXMpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIllvdSBtdXN0IHBhc3MgYW4gYXJyYXkgb2Ygc2NoZW1hcyB0byB6LnR1cGxlKFsgLi4uIF0pXCIpO1xuICAgIH1cbiAgICByZXR1cm4gbmV3IFpvZFR1cGxlKHtcbiAgICAgICAgaXRlbXM6IHNjaGVtYXMsXG4gICAgICAgIHR5cGVOYW1lOiBab2RGaXJzdFBhcnR5VHlwZUtpbmQuWm9kVHVwbGUsXG4gICAgICAgIHJlc3Q6IG51bGwsXG4gICAgICAgIC4uLnByb2Nlc3NDcmVhdGVQYXJhbXMocGFyYW1zKSxcbiAgICB9KTtcbn07XG5leHBvcnQgY2xhc3MgWm9kUmVjb3JkIGV4dGVuZHMgWm9kVHlwZSB7XG4gICAgZ2V0IGtleVNjaGVtYSgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2RlZi5rZXlUeXBlO1xuICAgIH1cbiAgICBnZXQgdmFsdWVTY2hlbWEoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9kZWYudmFsdWVUeXBlO1xuICAgIH1cbiAgICBfcGFyc2UoaW5wdXQpIHtcbiAgICAgICAgY29uc3QgeyBzdGF0dXMsIGN0eCB9ID0gdGhpcy5fcHJvY2Vzc0lucHV0UGFyYW1zKGlucHV0KTtcbiAgICAgICAgaWYgKGN0eC5wYXJzZWRUeXBlICE9PSBab2RQYXJzZWRUeXBlLm9iamVjdCkge1xuICAgICAgICAgICAgYWRkSXNzdWVUb0NvbnRleHQoY3R4LCB7XG4gICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLmludmFsaWRfdHlwZSxcbiAgICAgICAgICAgICAgICBleHBlY3RlZDogWm9kUGFyc2VkVHlwZS5vYmplY3QsXG4gICAgICAgICAgICAgICAgcmVjZWl2ZWQ6IGN0eC5wYXJzZWRUeXBlLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gSU5WQUxJRDtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBwYWlycyA9IFtdO1xuICAgICAgICBjb25zdCBrZXlUeXBlID0gdGhpcy5fZGVmLmtleVR5cGU7XG4gICAgICAgIGNvbnN0IHZhbHVlVHlwZSA9IHRoaXMuX2RlZi52YWx1ZVR5cGU7XG4gICAgICAgIGZvciAoY29uc3Qga2V5IGluIGN0eC5kYXRhKSB7XG4gICAgICAgICAgICBwYWlycy5wdXNoKHtcbiAgICAgICAgICAgICAgICBrZXk6IGtleVR5cGUuX3BhcnNlKG5ldyBQYXJzZUlucHV0TGF6eVBhdGgoY3R4LCBrZXksIGN0eC5wYXRoLCBrZXkpKSxcbiAgICAgICAgICAgICAgICB2YWx1ZTogdmFsdWVUeXBlLl9wYXJzZShuZXcgUGFyc2VJbnB1dExhenlQYXRoKGN0eCwgY3R4LmRhdGFba2V5XSwgY3R4LnBhdGgsIGtleSkpLFxuICAgICAgICAgICAgICAgIGFsd2F5c1NldDoga2V5IGluIGN0eC5kYXRhLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGN0eC5jb21tb24uYXN5bmMpIHtcbiAgICAgICAgICAgIHJldHVybiBQYXJzZVN0YXR1cy5tZXJnZU9iamVjdEFzeW5jKHN0YXR1cywgcGFpcnMpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIFBhcnNlU3RhdHVzLm1lcmdlT2JqZWN0U3luYyhzdGF0dXMsIHBhaXJzKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBnZXQgZWxlbWVudCgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2RlZi52YWx1ZVR5cGU7XG4gICAgfVxuICAgIHN0YXRpYyBjcmVhdGUoZmlyc3QsIHNlY29uZCwgdGhpcmQpIHtcbiAgICAgICAgaWYgKHNlY29uZCBpbnN0YW5jZW9mIFpvZFR5cGUpIHtcbiAgICAgICAgICAgIHJldHVybiBuZXcgWm9kUmVjb3JkKHtcbiAgICAgICAgICAgICAgICBrZXlUeXBlOiBmaXJzdCxcbiAgICAgICAgICAgICAgICB2YWx1ZVR5cGU6IHNlY29uZCxcbiAgICAgICAgICAgICAgICB0eXBlTmFtZTogWm9kRmlyc3RQYXJ0eVR5cGVLaW5kLlpvZFJlY29yZCxcbiAgICAgICAgICAgICAgICAuLi5wcm9jZXNzQ3JlYXRlUGFyYW1zKHRoaXJkKSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBuZXcgWm9kUmVjb3JkKHtcbiAgICAgICAgICAgIGtleVR5cGU6IFpvZFN0cmluZy5jcmVhdGUoKSxcbiAgICAgICAgICAgIHZhbHVlVHlwZTogZmlyc3QsXG4gICAgICAgICAgICB0eXBlTmFtZTogWm9kRmlyc3RQYXJ0eVR5cGVLaW5kLlpvZFJlY29yZCxcbiAgICAgICAgICAgIC4uLnByb2Nlc3NDcmVhdGVQYXJhbXMoc2Vjb25kKSxcbiAgICAgICAgfSk7XG4gICAgfVxufVxuZXhwb3J0IGNsYXNzIFpvZE1hcCBleHRlbmRzIFpvZFR5cGUge1xuICAgIGdldCBrZXlTY2hlbWEoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9kZWYua2V5VHlwZTtcbiAgICB9XG4gICAgZ2V0IHZhbHVlU2NoZW1hKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fZGVmLnZhbHVlVHlwZTtcbiAgICB9XG4gICAgX3BhcnNlKGlucHV0KSB7XG4gICAgICAgIGNvbnN0IHsgc3RhdHVzLCBjdHggfSA9IHRoaXMuX3Byb2Nlc3NJbnB1dFBhcmFtcyhpbnB1dCk7XG4gICAgICAgIGlmIChjdHgucGFyc2VkVHlwZSAhPT0gWm9kUGFyc2VkVHlwZS5tYXApIHtcbiAgICAgICAgICAgIGFkZElzc3VlVG9Db250ZXh0KGN0eCwge1xuICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS5pbnZhbGlkX3R5cGUsXG4gICAgICAgICAgICAgICAgZXhwZWN0ZWQ6IFpvZFBhcnNlZFR5cGUubWFwLFxuICAgICAgICAgICAgICAgIHJlY2VpdmVkOiBjdHgucGFyc2VkVHlwZSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIElOVkFMSUQ7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qga2V5VHlwZSA9IHRoaXMuX2RlZi5rZXlUeXBlO1xuICAgICAgICBjb25zdCB2YWx1ZVR5cGUgPSB0aGlzLl9kZWYudmFsdWVUeXBlO1xuICAgICAgICBjb25zdCBwYWlycyA9IFsuLi5jdHguZGF0YS5lbnRyaWVzKCldLm1hcCgoW2tleSwgdmFsdWVdLCBpbmRleCkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBrZXk6IGtleVR5cGUuX3BhcnNlKG5ldyBQYXJzZUlucHV0TGF6eVBhdGgoY3R4LCBrZXksIGN0eC5wYXRoLCBbaW5kZXgsIFwia2V5XCJdKSksXG4gICAgICAgICAgICAgICAgdmFsdWU6IHZhbHVlVHlwZS5fcGFyc2UobmV3IFBhcnNlSW5wdXRMYXp5UGF0aChjdHgsIHZhbHVlLCBjdHgucGF0aCwgW2luZGV4LCBcInZhbHVlXCJdKSksXG4gICAgICAgICAgICB9O1xuICAgICAgICB9KTtcbiAgICAgICAgaWYgKGN0eC5jb21tb24uYXN5bmMpIHtcbiAgICAgICAgICAgIGNvbnN0IGZpbmFsTWFwID0gbmV3IE1hcCgpO1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgcGFpciBvZiBwYWlycykge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBrZXkgPSBhd2FpdCBwYWlyLmtleTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdmFsdWUgPSBhd2FpdCBwYWlyLnZhbHVlO1xuICAgICAgICAgICAgICAgICAgICBpZiAoa2V5LnN0YXR1cyA9PT0gXCJhYm9ydGVkXCIgfHwgdmFsdWUuc3RhdHVzID09PSBcImFib3J0ZWRcIikge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIElOVkFMSUQ7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgaWYgKGtleS5zdGF0dXMgPT09IFwiZGlydHlcIiB8fCB2YWx1ZS5zdGF0dXMgPT09IFwiZGlydHlcIikge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzLmRpcnR5KCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgZmluYWxNYXAuc2V0KGtleS52YWx1ZSwgdmFsdWUudmFsdWUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4geyBzdGF0dXM6IHN0YXR1cy52YWx1ZSwgdmFsdWU6IGZpbmFsTWFwIH07XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IGZpbmFsTWFwID0gbmV3IE1hcCgpO1xuICAgICAgICAgICAgZm9yIChjb25zdCBwYWlyIG9mIHBhaXJzKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qga2V5ID0gcGFpci5rZXk7XG4gICAgICAgICAgICAgICAgY29uc3QgdmFsdWUgPSBwYWlyLnZhbHVlO1xuICAgICAgICAgICAgICAgIGlmIChrZXkuc3RhdHVzID09PSBcImFib3J0ZWRcIiB8fCB2YWx1ZS5zdGF0dXMgPT09IFwiYWJvcnRlZFwiKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBJTlZBTElEO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoa2V5LnN0YXR1cyA9PT0gXCJkaXJ0eVwiIHx8IHZhbHVlLnN0YXR1cyA9PT0gXCJkaXJ0eVwiKSB7XG4gICAgICAgICAgICAgICAgICAgIHN0YXR1cy5kaXJ0eSgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBmaW5hbE1hcC5zZXQoa2V5LnZhbHVlLCB2YWx1ZS52YWx1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4geyBzdGF0dXM6IHN0YXR1cy52YWx1ZSwgdmFsdWU6IGZpbmFsTWFwIH07XG4gICAgICAgIH1cbiAgICB9XG59XG5ab2RNYXAuY3JlYXRlID0gKGtleVR5cGUsIHZhbHVlVHlwZSwgcGFyYW1zKSA9PiB7XG4gICAgcmV0dXJuIG5ldyBab2RNYXAoe1xuICAgICAgICB2YWx1ZVR5cGUsXG4gICAgICAgIGtleVR5cGUsXG4gICAgICAgIHR5cGVOYW1lOiBab2RGaXJzdFBhcnR5VHlwZUtpbmQuWm9kTWFwLFxuICAgICAgICAuLi5wcm9jZXNzQ3JlYXRlUGFyYW1zKHBhcmFtcyksXG4gICAgfSk7XG59O1xuZXhwb3J0IGNsYXNzIFpvZFNldCBleHRlbmRzIFpvZFR5cGUge1xuICAgIF9wYXJzZShpbnB1dCkge1xuICAgICAgICBjb25zdCB7IHN0YXR1cywgY3R4IH0gPSB0aGlzLl9wcm9jZXNzSW5wdXRQYXJhbXMoaW5wdXQpO1xuICAgICAgICBpZiAoY3R4LnBhcnNlZFR5cGUgIT09IFpvZFBhcnNlZFR5cGUuc2V0KSB7XG4gICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICBjb2RlOiBab2RJc3N1ZUNvZGUuaW52YWxpZF90eXBlLFxuICAgICAgICAgICAgICAgIGV4cGVjdGVkOiBab2RQYXJzZWRUeXBlLnNldCxcbiAgICAgICAgICAgICAgICByZWNlaXZlZDogY3R4LnBhcnNlZFR5cGUsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiBJTlZBTElEO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGRlZiA9IHRoaXMuX2RlZjtcbiAgICAgICAgaWYgKGRlZi5taW5TaXplICE9PSBudWxsKSB7XG4gICAgICAgICAgICBpZiAoY3R4LmRhdGEuc2l6ZSA8IGRlZi5taW5TaXplLnZhbHVlKSB7XG4gICAgICAgICAgICAgICAgYWRkSXNzdWVUb0NvbnRleHQoY3R4LCB7XG4gICAgICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS50b29fc21hbGwsXG4gICAgICAgICAgICAgICAgICAgIG1pbmltdW06IGRlZi5taW5TaXplLnZhbHVlLFxuICAgICAgICAgICAgICAgICAgICB0eXBlOiBcInNldFwiLFxuICAgICAgICAgICAgICAgICAgICBpbmNsdXNpdmU6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgIGV4YWN0OiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogZGVmLm1pblNpemUubWVzc2FnZSxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBzdGF0dXMuZGlydHkoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAoZGVmLm1heFNpemUgIT09IG51bGwpIHtcbiAgICAgICAgICAgIGlmIChjdHguZGF0YS5zaXplID4gZGVmLm1heFNpemUudmFsdWUpIHtcbiAgICAgICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLnRvb19iaWcsXG4gICAgICAgICAgICAgICAgICAgIG1heGltdW06IGRlZi5tYXhTaXplLnZhbHVlLFxuICAgICAgICAgICAgICAgICAgICB0eXBlOiBcInNldFwiLFxuICAgICAgICAgICAgICAgICAgICBpbmNsdXNpdmU6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgIGV4YWN0OiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogZGVmLm1heFNpemUubWVzc2FnZSxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBzdGF0dXMuZGlydHkoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBjb25zdCB2YWx1ZVR5cGUgPSB0aGlzLl9kZWYudmFsdWVUeXBlO1xuICAgICAgICBmdW5jdGlvbiBmaW5hbGl6ZVNldChlbGVtZW50cykge1xuICAgICAgICAgICAgY29uc3QgcGFyc2VkU2V0ID0gbmV3IFNldCgpO1xuICAgICAgICAgICAgZm9yIChjb25zdCBlbGVtZW50IG9mIGVsZW1lbnRzKSB7XG4gICAgICAgICAgICAgICAgaWYgKGVsZW1lbnQuc3RhdHVzID09PSBcImFib3J0ZWRcIilcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIElOVkFMSUQ7XG4gICAgICAgICAgICAgICAgaWYgKGVsZW1lbnQuc3RhdHVzID09PSBcImRpcnR5XCIpXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1cy5kaXJ0eSgpO1xuICAgICAgICAgICAgICAgIHBhcnNlZFNldC5hZGQoZWxlbWVudC52YWx1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4geyBzdGF0dXM6IHN0YXR1cy52YWx1ZSwgdmFsdWU6IHBhcnNlZFNldCB9O1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGVsZW1lbnRzID0gWy4uLmN0eC5kYXRhLnZhbHVlcygpXS5tYXAoKGl0ZW0sIGkpID0+IHZhbHVlVHlwZS5fcGFyc2UobmV3IFBhcnNlSW5wdXRMYXp5UGF0aChjdHgsIGl0ZW0sIGN0eC5wYXRoLCBpKSkpO1xuICAgICAgICBpZiAoY3R4LmNvbW1vbi5hc3luYykge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKGVsZW1lbnRzKS50aGVuKChlbGVtZW50cykgPT4gZmluYWxpemVTZXQoZWxlbWVudHMpKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBmaW5hbGl6ZVNldChlbGVtZW50cyk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgbWluKG1pblNpemUsIG1lc3NhZ2UpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBab2RTZXQoe1xuICAgICAgICAgICAgLi4udGhpcy5fZGVmLFxuICAgICAgICAgICAgbWluU2l6ZTogeyB2YWx1ZTogbWluU2l6ZSwgbWVzc2FnZTogZXJyb3JVdGlsLnRvU3RyaW5nKG1lc3NhZ2UpIH0sXG4gICAgICAgIH0pO1xuICAgIH1cbiAgICBtYXgobWF4U2l6ZSwgbWVzc2FnZSkge1xuICAgICAgICByZXR1cm4gbmV3IFpvZFNldCh7XG4gICAgICAgICAgICAuLi50aGlzLl9kZWYsXG4gICAgICAgICAgICBtYXhTaXplOiB7IHZhbHVlOiBtYXhTaXplLCBtZXNzYWdlOiBlcnJvclV0aWwudG9TdHJpbmcobWVzc2FnZSkgfSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHNpemUoc2l6ZSwgbWVzc2FnZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5taW4oc2l6ZSwgbWVzc2FnZSkubWF4KHNpemUsIG1lc3NhZ2UpO1xuICAgIH1cbiAgICBub25lbXB0eShtZXNzYWdlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLm1pbigxLCBtZXNzYWdlKTtcbiAgICB9XG59XG5ab2RTZXQuY3JlYXRlID0gKHZhbHVlVHlwZSwgcGFyYW1zKSA9PiB7XG4gICAgcmV0dXJuIG5ldyBab2RTZXQoe1xuICAgICAgICB2YWx1ZVR5cGUsXG4gICAgICAgIG1pblNpemU6IG51bGwsXG4gICAgICAgIG1heFNpemU6IG51bGwsXG4gICAgICAgIHR5cGVOYW1lOiBab2RGaXJzdFBhcnR5VHlwZUtpbmQuWm9kU2V0LFxuICAgICAgICAuLi5wcm9jZXNzQ3JlYXRlUGFyYW1zKHBhcmFtcyksXG4gICAgfSk7XG59O1xuZXhwb3J0IGNsYXNzIFpvZEZ1bmN0aW9uIGV4dGVuZHMgWm9kVHlwZSB7XG4gICAgY29uc3RydWN0b3IoKSB7XG4gICAgICAgIHN1cGVyKC4uLmFyZ3VtZW50cyk7XG4gICAgICAgIHRoaXMudmFsaWRhdGUgPSB0aGlzLmltcGxlbWVudDtcbiAgICB9XG4gICAgX3BhcnNlKGlucHV0KSB7XG4gICAgICAgIGNvbnN0IHsgY3R4IH0gPSB0aGlzLl9wcm9jZXNzSW5wdXRQYXJhbXMoaW5wdXQpO1xuICAgICAgICBpZiAoY3R4LnBhcnNlZFR5cGUgIT09IFpvZFBhcnNlZFR5cGUuZnVuY3Rpb24pIHtcbiAgICAgICAgICAgIGFkZElzc3VlVG9Db250ZXh0KGN0eCwge1xuICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS5pbnZhbGlkX3R5cGUsXG4gICAgICAgICAgICAgICAgZXhwZWN0ZWQ6IFpvZFBhcnNlZFR5cGUuZnVuY3Rpb24sXG4gICAgICAgICAgICAgICAgcmVjZWl2ZWQ6IGN0eC5wYXJzZWRUeXBlLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gSU5WQUxJRDtcbiAgICAgICAgfVxuICAgICAgICBmdW5jdGlvbiBtYWtlQXJnc0lzc3VlKGFyZ3MsIGVycm9yKSB7XG4gICAgICAgICAgICByZXR1cm4gbWFrZUlzc3VlKHtcbiAgICAgICAgICAgICAgICBkYXRhOiBhcmdzLFxuICAgICAgICAgICAgICAgIHBhdGg6IGN0eC5wYXRoLFxuICAgICAgICAgICAgICAgIGVycm9yTWFwczogW2N0eC5jb21tb24uY29udGV4dHVhbEVycm9yTWFwLCBjdHguc2NoZW1hRXJyb3JNYXAsIGdldEVycm9yTWFwKCksIGRlZmF1bHRFcnJvck1hcF0uZmlsdGVyKCh4KSA9PiAhIXgpLFxuICAgICAgICAgICAgICAgIGlzc3VlRGF0YToge1xuICAgICAgICAgICAgICAgICAgICBjb2RlOiBab2RJc3N1ZUNvZGUuaW52YWxpZF9hcmd1bWVudHMsXG4gICAgICAgICAgICAgICAgICAgIGFyZ3VtZW50c0Vycm9yOiBlcnJvcixcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgZnVuY3Rpb24gbWFrZVJldHVybnNJc3N1ZShyZXR1cm5zLCBlcnJvcikge1xuICAgICAgICAgICAgcmV0dXJuIG1ha2VJc3N1ZSh7XG4gICAgICAgICAgICAgICAgZGF0YTogcmV0dXJucyxcbiAgICAgICAgICAgICAgICBwYXRoOiBjdHgucGF0aCxcbiAgICAgICAgICAgICAgICBlcnJvck1hcHM6IFtjdHguY29tbW9uLmNvbnRleHR1YWxFcnJvck1hcCwgY3R4LnNjaGVtYUVycm9yTWFwLCBnZXRFcnJvck1hcCgpLCBkZWZhdWx0RXJyb3JNYXBdLmZpbHRlcigoeCkgPT4gISF4KSxcbiAgICAgICAgICAgICAgICBpc3N1ZURhdGE6IHtcbiAgICAgICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLmludmFsaWRfcmV0dXJuX3R5cGUsXG4gICAgICAgICAgICAgICAgICAgIHJldHVyblR5cGVFcnJvcjogZXJyb3IsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHBhcmFtcyA9IHsgZXJyb3JNYXA6IGN0eC5jb21tb24uY29udGV4dHVhbEVycm9yTWFwIH07XG4gICAgICAgIGNvbnN0IGZuID0gY3R4LmRhdGE7XG4gICAgICAgIGlmICh0aGlzLl9kZWYucmV0dXJucyBpbnN0YW5jZW9mIFpvZFByb21pc2UpIHtcbiAgICAgICAgICAgIC8vIFdvdWxkIGxvdmUgYSB3YXkgdG8gYXZvaWQgZGlzYWJsaW5nIHRoaXMgcnVsZSwgYnV0IHdlIG5lZWRcbiAgICAgICAgICAgIC8vIGFuIGFsaWFzICh1c2luZyBhbiBhcnJvdyBmdW5jdGlvbiB3YXMgd2hhdCBjYXVzZWQgMjY1MSkuXG4gICAgICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLXRoaXMtYWxpYXNcbiAgICAgICAgICAgIGNvbnN0IG1lID0gdGhpcztcbiAgICAgICAgICAgIHJldHVybiBPSyhhc3luYyBmdW5jdGlvbiAoLi4uYXJncykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGVycm9yID0gbmV3IFpvZEVycm9yKFtdKTtcbiAgICAgICAgICAgICAgICBjb25zdCBwYXJzZWRBcmdzID0gYXdhaXQgbWUuX2RlZi5hcmdzLnBhcnNlQXN5bmMoYXJncywgcGFyYW1zKS5jYXRjaCgoZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBlcnJvci5hZGRJc3N1ZShtYWtlQXJnc0lzc3VlKGFyZ3MsIGUpKTtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgUmVmbGVjdC5hcHBseShmbiwgdGhpcywgcGFyc2VkQXJncyk7XG4gICAgICAgICAgICAgICAgY29uc3QgcGFyc2VkUmV0dXJucyA9IGF3YWl0IG1lLl9kZWYucmV0dXJucy5fZGVmLnR5cGVcbiAgICAgICAgICAgICAgICAgICAgLnBhcnNlQXN5bmMocmVzdWx0LCBwYXJhbXMpXG4gICAgICAgICAgICAgICAgICAgIC5jYXRjaCgoZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBlcnJvci5hZGRJc3N1ZShtYWtlUmV0dXJuc0lzc3VlKHJlc3VsdCwgZSkpO1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICByZXR1cm4gcGFyc2VkUmV0dXJucztcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgLy8gV291bGQgbG92ZSBhIHdheSB0byBhdm9pZCBkaXNhYmxpbmcgdGhpcyBydWxlLCBidXQgd2UgbmVlZFxuICAgICAgICAgICAgLy8gYW4gYWxpYXMgKHVzaW5nIGFuIGFycm93IGZ1bmN0aW9uIHdhcyB3aGF0IGNhdXNlZCAyNjUxKS5cbiAgICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tdGhpcy1hbGlhc1xuICAgICAgICAgICAgY29uc3QgbWUgPSB0aGlzO1xuICAgICAgICAgICAgcmV0dXJuIE9LKGZ1bmN0aW9uICguLi5hcmdzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgcGFyc2VkQXJncyA9IG1lLl9kZWYuYXJncy5zYWZlUGFyc2UoYXJncywgcGFyYW1zKTtcbiAgICAgICAgICAgICAgICBpZiAoIXBhcnNlZEFyZ3Muc3VjY2Vzcykge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgWm9kRXJyb3IoW21ha2VBcmdzSXNzdWUoYXJncywgcGFyc2VkQXJncy5lcnJvcildKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gUmVmbGVjdC5hcHBseShmbiwgdGhpcywgcGFyc2VkQXJncy5kYXRhKTtcbiAgICAgICAgICAgICAgICBjb25zdCBwYXJzZWRSZXR1cm5zID0gbWUuX2RlZi5yZXR1cm5zLnNhZmVQYXJzZShyZXN1bHQsIHBhcmFtcyk7XG4gICAgICAgICAgICAgICAgaWYgKCFwYXJzZWRSZXR1cm5zLnN1Y2Nlc3MpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IFpvZEVycm9yKFttYWtlUmV0dXJuc0lzc3VlKHJlc3VsdCwgcGFyc2VkUmV0dXJucy5lcnJvcildKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIHBhcnNlZFJldHVybnMuZGF0YTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuICAgIHBhcmFtZXRlcnMoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9kZWYuYXJncztcbiAgICB9XG4gICAgcmV0dXJuVHlwZSgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2RlZi5yZXR1cm5zO1xuICAgIH1cbiAgICBhcmdzKC4uLml0ZW1zKSB7XG4gICAgICAgIHJldHVybiBuZXcgWm9kRnVuY3Rpb24oe1xuICAgICAgICAgICAgLi4udGhpcy5fZGVmLFxuICAgICAgICAgICAgYXJnczogWm9kVHVwbGUuY3JlYXRlKGl0ZW1zKS5yZXN0KFpvZFVua25vd24uY3JlYXRlKCkpLFxuICAgICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJucyhyZXR1cm5UeXBlKSB7XG4gICAgICAgIHJldHVybiBuZXcgWm9kRnVuY3Rpb24oe1xuICAgICAgICAgICAgLi4udGhpcy5fZGVmLFxuICAgICAgICAgICAgcmV0dXJuczogcmV0dXJuVHlwZSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIGltcGxlbWVudChmdW5jKSB7XG4gICAgICAgIGNvbnN0IHZhbGlkYXRlZEZ1bmMgPSB0aGlzLnBhcnNlKGZ1bmMpO1xuICAgICAgICByZXR1cm4gdmFsaWRhdGVkRnVuYztcbiAgICB9XG4gICAgc3RyaWN0SW1wbGVtZW50KGZ1bmMpIHtcbiAgICAgICAgY29uc3QgdmFsaWRhdGVkRnVuYyA9IHRoaXMucGFyc2UoZnVuYyk7XG4gICAgICAgIHJldHVybiB2YWxpZGF0ZWRGdW5jO1xuICAgIH1cbiAgICBzdGF0aWMgY3JlYXRlKGFyZ3MsIHJldHVybnMsIHBhcmFtcykge1xuICAgICAgICByZXR1cm4gbmV3IFpvZEZ1bmN0aW9uKHtcbiAgICAgICAgICAgIGFyZ3M6IChhcmdzID8gYXJncyA6IFpvZFR1cGxlLmNyZWF0ZShbXSkucmVzdChab2RVbmtub3duLmNyZWF0ZSgpKSksXG4gICAgICAgICAgICByZXR1cm5zOiByZXR1cm5zIHx8IFpvZFVua25vd24uY3JlYXRlKCksXG4gICAgICAgICAgICB0eXBlTmFtZTogWm9kRmlyc3RQYXJ0eVR5cGVLaW5kLlpvZEZ1bmN0aW9uLFxuICAgICAgICAgICAgLi4ucHJvY2Vzc0NyZWF0ZVBhcmFtcyhwYXJhbXMpLFxuICAgICAgICB9KTtcbiAgICB9XG59XG5leHBvcnQgY2xhc3MgWm9kTGF6eSBleHRlbmRzIFpvZFR5cGUge1xuICAgIGdldCBzY2hlbWEoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9kZWYuZ2V0dGVyKCk7XG4gICAgfVxuICAgIF9wYXJzZShpbnB1dCkge1xuICAgICAgICBjb25zdCB7IGN0eCB9ID0gdGhpcy5fcHJvY2Vzc0lucHV0UGFyYW1zKGlucHV0KTtcbiAgICAgICAgY29uc3QgbGF6eVNjaGVtYSA9IHRoaXMuX2RlZi5nZXR0ZXIoKTtcbiAgICAgICAgcmV0dXJuIGxhenlTY2hlbWEuX3BhcnNlKHsgZGF0YTogY3R4LmRhdGEsIHBhdGg6IGN0eC5wYXRoLCBwYXJlbnQ6IGN0eCB9KTtcbiAgICB9XG59XG5ab2RMYXp5LmNyZWF0ZSA9IChnZXR0ZXIsIHBhcmFtcykgPT4ge1xuICAgIHJldHVybiBuZXcgWm9kTGF6eSh7XG4gICAgICAgIGdldHRlcjogZ2V0dGVyLFxuICAgICAgICB0eXBlTmFtZTogWm9kRmlyc3RQYXJ0eVR5cGVLaW5kLlpvZExhenksXG4gICAgICAgIC4uLnByb2Nlc3NDcmVhdGVQYXJhbXMocGFyYW1zKSxcbiAgICB9KTtcbn07XG5leHBvcnQgY2xhc3MgWm9kTGl0ZXJhbCBleHRlbmRzIFpvZFR5cGUge1xuICAgIF9wYXJzZShpbnB1dCkge1xuICAgICAgICBpZiAoaW5wdXQuZGF0YSAhPT0gdGhpcy5fZGVmLnZhbHVlKSB7XG4gICAgICAgICAgICBjb25zdCBjdHggPSB0aGlzLl9nZXRPclJldHVybkN0eChpbnB1dCk7XG4gICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICByZWNlaXZlZDogY3R4LmRhdGEsXG4gICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLmludmFsaWRfbGl0ZXJhbCxcbiAgICAgICAgICAgICAgICBleHBlY3RlZDogdGhpcy5fZGVmLnZhbHVlLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gSU5WQUxJRDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4geyBzdGF0dXM6IFwidmFsaWRcIiwgdmFsdWU6IGlucHV0LmRhdGEgfTtcbiAgICB9XG4gICAgZ2V0IHZhbHVlKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fZGVmLnZhbHVlO1xuICAgIH1cbn1cblpvZExpdGVyYWwuY3JlYXRlID0gKHZhbHVlLCBwYXJhbXMpID0+IHtcbiAgICByZXR1cm4gbmV3IFpvZExpdGVyYWwoe1xuICAgICAgICB2YWx1ZTogdmFsdWUsXG4gICAgICAgIHR5cGVOYW1lOiBab2RGaXJzdFBhcnR5VHlwZUtpbmQuWm9kTGl0ZXJhbCxcbiAgICAgICAgLi4ucHJvY2Vzc0NyZWF0ZVBhcmFtcyhwYXJhbXMpLFxuICAgIH0pO1xufTtcbmZ1bmN0aW9uIGNyZWF0ZVpvZEVudW0odmFsdWVzLCBwYXJhbXMpIHtcbiAgICByZXR1cm4gbmV3IFpvZEVudW0oe1xuICAgICAgICB2YWx1ZXMsXG4gICAgICAgIHR5cGVOYW1lOiBab2RGaXJzdFBhcnR5VHlwZUtpbmQuWm9kRW51bSxcbiAgICAgICAgLi4ucHJvY2Vzc0NyZWF0ZVBhcmFtcyhwYXJhbXMpLFxuICAgIH0pO1xufVxuZXhwb3J0IGNsYXNzIFpvZEVudW0gZXh0ZW5kcyBab2RUeXBlIHtcbiAgICBfcGFyc2UoaW5wdXQpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBpbnB1dC5kYXRhICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgICBjb25zdCBjdHggPSB0aGlzLl9nZXRPclJldHVybkN0eChpbnB1dCk7XG4gICAgICAgICAgICBjb25zdCBleHBlY3RlZFZhbHVlcyA9IHRoaXMuX2RlZi52YWx1ZXM7XG4gICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICBleHBlY3RlZDogdXRpbC5qb2luVmFsdWVzKGV4cGVjdGVkVmFsdWVzKSxcbiAgICAgICAgICAgICAgICByZWNlaXZlZDogY3R4LnBhcnNlZFR5cGUsXG4gICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLmludmFsaWRfdHlwZSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIElOVkFMSUQ7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCF0aGlzLl9jYWNoZSkge1xuICAgICAgICAgICAgdGhpcy5fY2FjaGUgPSBuZXcgU2V0KHRoaXMuX2RlZi52YWx1ZXMpO1xuICAgICAgICB9XG4gICAgICAgIGlmICghdGhpcy5fY2FjaGUuaGFzKGlucHV0LmRhdGEpKSB7XG4gICAgICAgICAgICBjb25zdCBjdHggPSB0aGlzLl9nZXRPclJldHVybkN0eChpbnB1dCk7XG4gICAgICAgICAgICBjb25zdCBleHBlY3RlZFZhbHVlcyA9IHRoaXMuX2RlZi52YWx1ZXM7XG4gICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICByZWNlaXZlZDogY3R4LmRhdGEsXG4gICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLmludmFsaWRfZW51bV92YWx1ZSxcbiAgICAgICAgICAgICAgICBvcHRpb25zOiBleHBlY3RlZFZhbHVlcyxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIElOVkFMSUQ7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIE9LKGlucHV0LmRhdGEpO1xuICAgIH1cbiAgICBnZXQgb3B0aW9ucygpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2RlZi52YWx1ZXM7XG4gICAgfVxuICAgIGdldCBlbnVtKCkge1xuICAgICAgICBjb25zdCBlbnVtVmFsdWVzID0ge307XG4gICAgICAgIGZvciAoY29uc3QgdmFsIG9mIHRoaXMuX2RlZi52YWx1ZXMpIHtcbiAgICAgICAgICAgIGVudW1WYWx1ZXNbdmFsXSA9IHZhbDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZW51bVZhbHVlcztcbiAgICB9XG4gICAgZ2V0IFZhbHVlcygpIHtcbiAgICAgICAgY29uc3QgZW51bVZhbHVlcyA9IHt9O1xuICAgICAgICBmb3IgKGNvbnN0IHZhbCBvZiB0aGlzLl9kZWYudmFsdWVzKSB7XG4gICAgICAgICAgICBlbnVtVmFsdWVzW3ZhbF0gPSB2YWw7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGVudW1WYWx1ZXM7XG4gICAgfVxuICAgIGdldCBFbnVtKCkge1xuICAgICAgICBjb25zdCBlbnVtVmFsdWVzID0ge307XG4gICAgICAgIGZvciAoY29uc3QgdmFsIG9mIHRoaXMuX2RlZi52YWx1ZXMpIHtcbiAgICAgICAgICAgIGVudW1WYWx1ZXNbdmFsXSA9IHZhbDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZW51bVZhbHVlcztcbiAgICB9XG4gICAgZXh0cmFjdCh2YWx1ZXMsIG5ld0RlZiA9IHRoaXMuX2RlZikge1xuICAgICAgICByZXR1cm4gWm9kRW51bS5jcmVhdGUodmFsdWVzLCB7XG4gICAgICAgICAgICAuLi50aGlzLl9kZWYsXG4gICAgICAgICAgICAuLi5uZXdEZWYsXG4gICAgICAgIH0pO1xuICAgIH1cbiAgICBleGNsdWRlKHZhbHVlcywgbmV3RGVmID0gdGhpcy5fZGVmKSB7XG4gICAgICAgIHJldHVybiBab2RFbnVtLmNyZWF0ZSh0aGlzLm9wdGlvbnMuZmlsdGVyKChvcHQpID0+ICF2YWx1ZXMuaW5jbHVkZXMob3B0KSksIHtcbiAgICAgICAgICAgIC4uLnRoaXMuX2RlZixcbiAgICAgICAgICAgIC4uLm5ld0RlZixcbiAgICAgICAgfSk7XG4gICAgfVxufVxuWm9kRW51bS5jcmVhdGUgPSBjcmVhdGVab2RFbnVtO1xuZXhwb3J0IGNsYXNzIFpvZE5hdGl2ZUVudW0gZXh0ZW5kcyBab2RUeXBlIHtcbiAgICBfcGFyc2UoaW5wdXQpIHtcbiAgICAgICAgY29uc3QgbmF0aXZlRW51bVZhbHVlcyA9IHV0aWwuZ2V0VmFsaWRFbnVtVmFsdWVzKHRoaXMuX2RlZi52YWx1ZXMpO1xuICAgICAgICBjb25zdCBjdHggPSB0aGlzLl9nZXRPclJldHVybkN0eChpbnB1dCk7XG4gICAgICAgIGlmIChjdHgucGFyc2VkVHlwZSAhPT0gWm9kUGFyc2VkVHlwZS5zdHJpbmcgJiYgY3R4LnBhcnNlZFR5cGUgIT09IFpvZFBhcnNlZFR5cGUubnVtYmVyKSB7XG4gICAgICAgICAgICBjb25zdCBleHBlY3RlZFZhbHVlcyA9IHV0aWwub2JqZWN0VmFsdWVzKG5hdGl2ZUVudW1WYWx1ZXMpO1xuICAgICAgICAgICAgYWRkSXNzdWVUb0NvbnRleHQoY3R4LCB7XG4gICAgICAgICAgICAgICAgZXhwZWN0ZWQ6IHV0aWwuam9pblZhbHVlcyhleHBlY3RlZFZhbHVlcyksXG4gICAgICAgICAgICAgICAgcmVjZWl2ZWQ6IGN0eC5wYXJzZWRUeXBlLFxuICAgICAgICAgICAgICAgIGNvZGU6IFpvZElzc3VlQ29kZS5pbnZhbGlkX3R5cGUsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiBJTlZBTElEO1xuICAgICAgICB9XG4gICAgICAgIGlmICghdGhpcy5fY2FjaGUpIHtcbiAgICAgICAgICAgIHRoaXMuX2NhY2hlID0gbmV3IFNldCh1dGlsLmdldFZhbGlkRW51bVZhbHVlcyh0aGlzLl9kZWYudmFsdWVzKSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCF0aGlzLl9jYWNoZS5oYXMoaW5wdXQuZGF0YSkpIHtcbiAgICAgICAgICAgIGNvbnN0IGV4cGVjdGVkVmFsdWVzID0gdXRpbC5vYmplY3RWYWx1ZXMobmF0aXZlRW51bVZhbHVlcyk7XG4gICAgICAgICAgICBhZGRJc3N1ZVRvQ29udGV4dChjdHgsIHtcbiAgICAgICAgICAgICAgICByZWNlaXZlZDogY3R4LmRhdGEsXG4gICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLmludmFsaWRfZW51bV92YWx1ZSxcbiAgICAgICAgICAgICAgICBvcHRpb25zOiBleHBlY3RlZFZhbHVlcyxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIElOVkFMSUQ7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIE9LKGlucHV0LmRhdGEpO1xuICAgIH1cbiAgICBnZXQgZW51bSgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2RlZi52YWx1ZXM7XG4gICAgfVxufVxuWm9kTmF0aXZlRW51bS5jcmVhdGUgPSAodmFsdWVzLCBwYXJhbXMpID0+IHtcbiAgICByZXR1cm4gbmV3IFpvZE5hdGl2ZUVudW0oe1xuICAgICAgICB2YWx1ZXM6IHZhbHVlcyxcbiAgICAgICAgdHlwZU5hbWU6IFpvZEZpcnN0UGFydHlUeXBlS2luZC5ab2ROYXRpdmVFbnVtLFxuICAgICAgICAuLi5wcm9jZXNzQ3JlYXRlUGFyYW1zKHBhcmFtcyksXG4gICAgfSk7XG59O1xuZXhwb3J0IGNsYXNzIFpvZFByb21pc2UgZXh0ZW5kcyBab2RUeXBlIHtcbiAgICB1bndyYXAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9kZWYudHlwZTtcbiAgICB9XG4gICAgX3BhcnNlKGlucHV0KSB7XG4gICAgICAgIGNvbnN0IHsgY3R4IH0gPSB0aGlzLl9wcm9jZXNzSW5wdXRQYXJhbXMoaW5wdXQpO1xuICAgICAgICBpZiAoY3R4LnBhcnNlZFR5cGUgIT09IFpvZFBhcnNlZFR5cGUucHJvbWlzZSAmJiBjdHguY29tbW9uLmFzeW5jID09PSBmYWxzZSkge1xuICAgICAgICAgICAgYWRkSXNzdWVUb0NvbnRleHQoY3R4LCB7XG4gICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLmludmFsaWRfdHlwZSxcbiAgICAgICAgICAgICAgICBleHBlY3RlZDogWm9kUGFyc2VkVHlwZS5wcm9taXNlLFxuICAgICAgICAgICAgICAgIHJlY2VpdmVkOiBjdHgucGFyc2VkVHlwZSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIElOVkFMSUQ7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcHJvbWlzaWZpZWQgPSBjdHgucGFyc2VkVHlwZSA9PT0gWm9kUGFyc2VkVHlwZS5wcm9taXNlID8gY3R4LmRhdGEgOiBQcm9taXNlLnJlc29sdmUoY3R4LmRhdGEpO1xuICAgICAgICByZXR1cm4gT0socHJvbWlzaWZpZWQudGhlbigoZGF0YSkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2RlZi50eXBlLnBhcnNlQXN5bmMoZGF0YSwge1xuICAgICAgICAgICAgICAgIHBhdGg6IGN0eC5wYXRoLFxuICAgICAgICAgICAgICAgIGVycm9yTWFwOiBjdHguY29tbW9uLmNvbnRleHR1YWxFcnJvck1hcCxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KSk7XG4gICAgfVxufVxuWm9kUHJvbWlzZS5jcmVhdGUgPSAoc2NoZW1hLCBwYXJhbXMpID0+IHtcbiAgICByZXR1cm4gbmV3IFpvZFByb21pc2Uoe1xuICAgICAgICB0eXBlOiBzY2hlbWEsXG4gICAgICAgIHR5cGVOYW1lOiBab2RGaXJzdFBhcnR5VHlwZUtpbmQuWm9kUHJvbWlzZSxcbiAgICAgICAgLi4ucHJvY2Vzc0NyZWF0ZVBhcmFtcyhwYXJhbXMpLFxuICAgIH0pO1xufTtcbmV4cG9ydCBjbGFzcyBab2RFZmZlY3RzIGV4dGVuZHMgWm9kVHlwZSB7XG4gICAgaW5uZXJUeXBlKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fZGVmLnNjaGVtYTtcbiAgICB9XG4gICAgc291cmNlVHlwZSgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2RlZi5zY2hlbWEuX2RlZi50eXBlTmFtZSA9PT0gWm9kRmlyc3RQYXJ0eVR5cGVLaW5kLlpvZEVmZmVjdHNcbiAgICAgICAgICAgID8gdGhpcy5fZGVmLnNjaGVtYS5zb3VyY2VUeXBlKClcbiAgICAgICAgICAgIDogdGhpcy5fZGVmLnNjaGVtYTtcbiAgICB9XG4gICAgX3BhcnNlKGlucHV0KSB7XG4gICAgICAgIGNvbnN0IHsgc3RhdHVzLCBjdHggfSA9IHRoaXMuX3Byb2Nlc3NJbnB1dFBhcmFtcyhpbnB1dCk7XG4gICAgICAgIGNvbnN0IGVmZmVjdCA9IHRoaXMuX2RlZi5lZmZlY3QgfHwgbnVsbDtcbiAgICAgICAgY29uc3QgY2hlY2tDdHggPSB7XG4gICAgICAgICAgICBhZGRJc3N1ZTogKGFyZykgPT4ge1xuICAgICAgICAgICAgICAgIGFkZElzc3VlVG9Db250ZXh0KGN0eCwgYXJnKTtcbiAgICAgICAgICAgICAgICBpZiAoYXJnLmZhdGFsKSB7XG4gICAgICAgICAgICAgICAgICAgIHN0YXR1cy5hYm9ydCgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzLmRpcnR5KCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGdldCBwYXRoKCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBjdHgucGF0aDtcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH07XG4gICAgICAgIGNoZWNrQ3R4LmFkZElzc3VlID0gY2hlY2tDdHguYWRkSXNzdWUuYmluZChjaGVja0N0eCk7XG4gICAgICAgIGlmIChlZmZlY3QudHlwZSA9PT0gXCJwcmVwcm9jZXNzXCIpIHtcbiAgICAgICAgICAgIGNvbnN0IHByb2Nlc3NlZCA9IGVmZmVjdC50cmFuc2Zvcm0oY3R4LmRhdGEsIGNoZWNrQ3R4KTtcbiAgICAgICAgICAgIGlmIChjdHguY29tbW9uLmFzeW5jKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShwcm9jZXNzZWQpLnRoZW4oYXN5bmMgKHByb2Nlc3NlZCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBpZiAoc3RhdHVzLnZhbHVlID09PSBcImFib3J0ZWRcIilcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBJTlZBTElEO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLl9kZWYuc2NoZW1hLl9wYXJzZUFzeW5jKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRhdGE6IHByb2Nlc3NlZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhdGg6IGN0eC5wYXRoLFxuICAgICAgICAgICAgICAgICAgICAgICAgcGFyZW50OiBjdHgsXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICBpZiAocmVzdWx0LnN0YXR1cyA9PT0gXCJhYm9ydGVkXCIpXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gSU5WQUxJRDtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHJlc3VsdC5zdGF0dXMgPT09IFwiZGlydHlcIilcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBESVJUWShyZXN1bHQudmFsdWUpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoc3RhdHVzLnZhbHVlID09PSBcImRpcnR5XCIpXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gRElSVFkocmVzdWx0LnZhbHVlKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIGlmIChzdGF0dXMudmFsdWUgPT09IFwiYWJvcnRlZFwiKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gSU5WQUxJRDtcbiAgICAgICAgICAgICAgICBjb25zdCByZXN1bHQgPSB0aGlzLl9kZWYuc2NoZW1hLl9wYXJzZVN5bmMoe1xuICAgICAgICAgICAgICAgICAgICBkYXRhOiBwcm9jZXNzZWQsXG4gICAgICAgICAgICAgICAgICAgIHBhdGg6IGN0eC5wYXRoLFxuICAgICAgICAgICAgICAgICAgICBwYXJlbnQ6IGN0eCxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBpZiAocmVzdWx0LnN0YXR1cyA9PT0gXCJhYm9ydGVkXCIpXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBJTlZBTElEO1xuICAgICAgICAgICAgICAgIGlmIChyZXN1bHQuc3RhdHVzID09PSBcImRpcnR5XCIpXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBESVJUWShyZXN1bHQudmFsdWUpO1xuICAgICAgICAgICAgICAgIGlmIChzdGF0dXMudmFsdWUgPT09IFwiZGlydHlcIilcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIERJUlRZKHJlc3VsdC52YWx1ZSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAoZWZmZWN0LnR5cGUgPT09IFwicmVmaW5lbWVudFwiKSB7XG4gICAgICAgICAgICBjb25zdCBleGVjdXRlUmVmaW5lbWVudCA9IChhY2MpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCByZXN1bHQgPSBlZmZlY3QucmVmaW5lbWVudChhY2MsIGNoZWNrQ3R4KTtcbiAgICAgICAgICAgICAgICBpZiAoY3R4LmNvbW1vbi5hc3luYykge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHJlc3VsdCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChyZXN1bHQgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkFzeW5jIHJlZmluZW1lbnQgZW5jb3VudGVyZWQgZHVyaW5nIHN5bmNocm9ub3VzIHBhcnNlIG9wZXJhdGlvbi4gVXNlIC5wYXJzZUFzeW5jIGluc3RlYWQuXCIpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gYWNjO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGlmIChjdHguY29tbW9uLmFzeW5jID09PSBmYWxzZSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGlubmVyID0gdGhpcy5fZGVmLnNjaGVtYS5fcGFyc2VTeW5jKHtcbiAgICAgICAgICAgICAgICAgICAgZGF0YTogY3R4LmRhdGEsXG4gICAgICAgICAgICAgICAgICAgIHBhdGg6IGN0eC5wYXRoLFxuICAgICAgICAgICAgICAgICAgICBwYXJlbnQ6IGN0eCxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBpZiAoaW5uZXIuc3RhdHVzID09PSBcImFib3J0ZWRcIilcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIElOVkFMSUQ7XG4gICAgICAgICAgICAgICAgaWYgKGlubmVyLnN0YXR1cyA9PT0gXCJkaXJ0eVwiKVxuICAgICAgICAgICAgICAgICAgICBzdGF0dXMuZGlydHkoKTtcbiAgICAgICAgICAgICAgICAvLyByZXR1cm4gdmFsdWUgaXMgaWdub3JlZFxuICAgICAgICAgICAgICAgIGV4ZWN1dGVSZWZpbmVtZW50KGlubmVyLnZhbHVlKTtcbiAgICAgICAgICAgICAgICByZXR1cm4geyBzdGF0dXM6IHN0YXR1cy52YWx1ZSwgdmFsdWU6IGlubmVyLnZhbHVlIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5fZGVmLnNjaGVtYS5fcGFyc2VBc3luYyh7IGRhdGE6IGN0eC5kYXRhLCBwYXRoOiBjdHgucGF0aCwgcGFyZW50OiBjdHggfSkudGhlbigoaW5uZXIpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGlubmVyLnN0YXR1cyA9PT0gXCJhYm9ydGVkXCIpXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gSU5WQUxJRDtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGlubmVyLnN0YXR1cyA9PT0gXCJkaXJ0eVwiKVxuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzLmRpcnR5KCk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBleGVjdXRlUmVmaW5lbWVudChpbm5lci52YWx1ZSkudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4geyBzdGF0dXM6IHN0YXR1cy52YWx1ZSwgdmFsdWU6IGlubmVyLnZhbHVlIH07XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChlZmZlY3QudHlwZSA9PT0gXCJ0cmFuc2Zvcm1cIikge1xuICAgICAgICAgICAgaWYgKGN0eC5jb21tb24uYXN5bmMgPT09IGZhbHNlKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgYmFzZSA9IHRoaXMuX2RlZi5zY2hlbWEuX3BhcnNlU3luYyh7XG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IGN0eC5kYXRhLFxuICAgICAgICAgICAgICAgICAgICBwYXRoOiBjdHgucGF0aCxcbiAgICAgICAgICAgICAgICAgICAgcGFyZW50OiBjdHgsXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgaWYgKCFpc1ZhbGlkKGJhc2UpKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gSU5WQUxJRDtcbiAgICAgICAgICAgICAgICBjb25zdCByZXN1bHQgPSBlZmZlY3QudHJhbnNmb3JtKGJhc2UudmFsdWUsIGNoZWNrQ3R4KTtcbiAgICAgICAgICAgICAgICBpZiAocmVzdWx0IGluc3RhbmNlb2YgUHJvbWlzZSkge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEFzeW5jaHJvbm91cyB0cmFuc2Zvcm0gZW5jb3VudGVyZWQgZHVyaW5nIHN5bmNocm9ub3VzIHBhcnNlIG9wZXJhdGlvbi4gVXNlIC5wYXJzZUFzeW5jIGluc3RlYWQuYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiB7IHN0YXR1czogc3RhdHVzLnZhbHVlLCB2YWx1ZTogcmVzdWx0IH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5fZGVmLnNjaGVtYS5fcGFyc2VBc3luYyh7IGRhdGE6IGN0eC5kYXRhLCBwYXRoOiBjdHgucGF0aCwgcGFyZW50OiBjdHggfSkudGhlbigoYmFzZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIWlzVmFsaWQoYmFzZSkpXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gSU5WQUxJRDtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShlZmZlY3QudHJhbnNmb3JtKGJhc2UudmFsdWUsIGNoZWNrQ3R4KSkudGhlbigocmVzdWx0KSA9PiAoe1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiBzdGF0dXMudmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZTogcmVzdWx0LFxuICAgICAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgdXRpbC5hc3NlcnROZXZlcihlZmZlY3QpO1xuICAgIH1cbn1cblpvZEVmZmVjdHMuY3JlYXRlID0gKHNjaGVtYSwgZWZmZWN0LCBwYXJhbXMpID0+IHtcbiAgICByZXR1cm4gbmV3IFpvZEVmZmVjdHMoe1xuICAgICAgICBzY2hlbWEsXG4gICAgICAgIHR5cGVOYW1lOiBab2RGaXJzdFBhcnR5VHlwZUtpbmQuWm9kRWZmZWN0cyxcbiAgICAgICAgZWZmZWN0LFxuICAgICAgICAuLi5wcm9jZXNzQ3JlYXRlUGFyYW1zKHBhcmFtcyksXG4gICAgfSk7XG59O1xuWm9kRWZmZWN0cy5jcmVhdGVXaXRoUHJlcHJvY2VzcyA9IChwcmVwcm9jZXNzLCBzY2hlbWEsIHBhcmFtcykgPT4ge1xuICAgIHJldHVybiBuZXcgWm9kRWZmZWN0cyh7XG4gICAgICAgIHNjaGVtYSxcbiAgICAgICAgZWZmZWN0OiB7IHR5cGU6IFwicHJlcHJvY2Vzc1wiLCB0cmFuc2Zvcm06IHByZXByb2Nlc3MgfSxcbiAgICAgICAgdHlwZU5hbWU6IFpvZEZpcnN0UGFydHlUeXBlS2luZC5ab2RFZmZlY3RzLFxuICAgICAgICAuLi5wcm9jZXNzQ3JlYXRlUGFyYW1zKHBhcmFtcyksXG4gICAgfSk7XG59O1xuZXhwb3J0IHsgWm9kRWZmZWN0cyBhcyBab2RUcmFuc2Zvcm1lciB9O1xuZXhwb3J0IGNsYXNzIFpvZE9wdGlvbmFsIGV4dGVuZHMgWm9kVHlwZSB7XG4gICAgX3BhcnNlKGlucHV0KSB7XG4gICAgICAgIGNvbnN0IHBhcnNlZFR5cGUgPSB0aGlzLl9nZXRUeXBlKGlucHV0KTtcbiAgICAgICAgaWYgKHBhcnNlZFR5cGUgPT09IFpvZFBhcnNlZFR5cGUudW5kZWZpbmVkKSB7XG4gICAgICAgICAgICByZXR1cm4gT0sodW5kZWZpbmVkKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5fZGVmLmlubmVyVHlwZS5fcGFyc2UoaW5wdXQpO1xuICAgIH1cbiAgICB1bndyYXAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9kZWYuaW5uZXJUeXBlO1xuICAgIH1cbn1cblpvZE9wdGlvbmFsLmNyZWF0ZSA9ICh0eXBlLCBwYXJhbXMpID0+IHtcbiAgICByZXR1cm4gbmV3IFpvZE9wdGlvbmFsKHtcbiAgICAgICAgaW5uZXJUeXBlOiB0eXBlLFxuICAgICAgICB0eXBlTmFtZTogWm9kRmlyc3RQYXJ0eVR5cGVLaW5kLlpvZE9wdGlvbmFsLFxuICAgICAgICAuLi5wcm9jZXNzQ3JlYXRlUGFyYW1zKHBhcmFtcyksXG4gICAgfSk7XG59O1xuZXhwb3J0IGNsYXNzIFpvZE51bGxhYmxlIGV4dGVuZHMgWm9kVHlwZSB7XG4gICAgX3BhcnNlKGlucHV0KSB7XG4gICAgICAgIGNvbnN0IHBhcnNlZFR5cGUgPSB0aGlzLl9nZXRUeXBlKGlucHV0KTtcbiAgICAgICAgaWYgKHBhcnNlZFR5cGUgPT09IFpvZFBhcnNlZFR5cGUubnVsbCkge1xuICAgICAgICAgICAgcmV0dXJuIE9LKG51bGwpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9kZWYuaW5uZXJUeXBlLl9wYXJzZShpbnB1dCk7XG4gICAgfVxuICAgIHVud3JhcCgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2RlZi5pbm5lclR5cGU7XG4gICAgfVxufVxuWm9kTnVsbGFibGUuY3JlYXRlID0gKHR5cGUsIHBhcmFtcykgPT4ge1xuICAgIHJldHVybiBuZXcgWm9kTnVsbGFibGUoe1xuICAgICAgICBpbm5lclR5cGU6IHR5cGUsXG4gICAgICAgIHR5cGVOYW1lOiBab2RGaXJzdFBhcnR5VHlwZUtpbmQuWm9kTnVsbGFibGUsXG4gICAgICAgIC4uLnByb2Nlc3NDcmVhdGVQYXJhbXMocGFyYW1zKSxcbiAgICB9KTtcbn07XG5leHBvcnQgY2xhc3MgWm9kRGVmYXVsdCBleHRlbmRzIFpvZFR5cGUge1xuICAgIF9wYXJzZShpbnB1dCkge1xuICAgICAgICBjb25zdCB7IGN0eCB9ID0gdGhpcy5fcHJvY2Vzc0lucHV0UGFyYW1zKGlucHV0KTtcbiAgICAgICAgbGV0IGRhdGEgPSBjdHguZGF0YTtcbiAgICAgICAgaWYgKGN0eC5wYXJzZWRUeXBlID09PSBab2RQYXJzZWRUeXBlLnVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZGF0YSA9IHRoaXMuX2RlZi5kZWZhdWx0VmFsdWUoKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5fZGVmLmlubmVyVHlwZS5fcGFyc2Uoe1xuICAgICAgICAgICAgZGF0YSxcbiAgICAgICAgICAgIHBhdGg6IGN0eC5wYXRoLFxuICAgICAgICAgICAgcGFyZW50OiBjdHgsXG4gICAgICAgIH0pO1xuICAgIH1cbiAgICByZW1vdmVEZWZhdWx0KCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fZGVmLmlubmVyVHlwZTtcbiAgICB9XG59XG5ab2REZWZhdWx0LmNyZWF0ZSA9ICh0eXBlLCBwYXJhbXMpID0+IHtcbiAgICByZXR1cm4gbmV3IFpvZERlZmF1bHQoe1xuICAgICAgICBpbm5lclR5cGU6IHR5cGUsXG4gICAgICAgIHR5cGVOYW1lOiBab2RGaXJzdFBhcnR5VHlwZUtpbmQuWm9kRGVmYXVsdCxcbiAgICAgICAgZGVmYXVsdFZhbHVlOiB0eXBlb2YgcGFyYW1zLmRlZmF1bHQgPT09IFwiZnVuY3Rpb25cIiA/IHBhcmFtcy5kZWZhdWx0IDogKCkgPT4gcGFyYW1zLmRlZmF1bHQsXG4gICAgICAgIC4uLnByb2Nlc3NDcmVhdGVQYXJhbXMocGFyYW1zKSxcbiAgICB9KTtcbn07XG5leHBvcnQgY2xhc3MgWm9kQ2F0Y2ggZXh0ZW5kcyBab2RUeXBlIHtcbiAgICBfcGFyc2UoaW5wdXQpIHtcbiAgICAgICAgY29uc3QgeyBjdHggfSA9IHRoaXMuX3Byb2Nlc3NJbnB1dFBhcmFtcyhpbnB1dCk7XG4gICAgICAgIC8vIG5ld0N0eCBpcyB1c2VkIHRvIG5vdCBjb2xsZWN0IGlzc3VlcyBmcm9tIGlubmVyIHR5cGVzIGluIGN0eFxuICAgICAgICBjb25zdCBuZXdDdHggPSB7XG4gICAgICAgICAgICAuLi5jdHgsXG4gICAgICAgICAgICBjb21tb246IHtcbiAgICAgICAgICAgICAgICAuLi5jdHguY29tbW9uLFxuICAgICAgICAgICAgICAgIGlzc3VlczogW10sXG4gICAgICAgICAgICB9LFxuICAgICAgICB9O1xuICAgICAgICBjb25zdCByZXN1bHQgPSB0aGlzLl9kZWYuaW5uZXJUeXBlLl9wYXJzZSh7XG4gICAgICAgICAgICBkYXRhOiBuZXdDdHguZGF0YSxcbiAgICAgICAgICAgIHBhdGg6IG5ld0N0eC5wYXRoLFxuICAgICAgICAgICAgcGFyZW50OiB7XG4gICAgICAgICAgICAgICAgLi4ubmV3Q3R4LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgICAgIGlmIChpc0FzeW5jKHJlc3VsdCkpIHtcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQudGhlbigocmVzdWx0KSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiBcInZhbGlkXCIsXG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiByZXN1bHQuc3RhdHVzID09PSBcInZhbGlkXCJcbiAgICAgICAgICAgICAgICAgICAgICAgID8gcmVzdWx0LnZhbHVlXG4gICAgICAgICAgICAgICAgICAgICAgICA6IHRoaXMuX2RlZi5jYXRjaFZhbHVlKHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBnZXQgZXJyb3IoKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXcgWm9kRXJyb3IobmV3Q3R4LmNvbW1vbi5pc3N1ZXMpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5wdXQ6IG5ld0N0eC5kYXRhLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBzdGF0dXM6IFwidmFsaWRcIixcbiAgICAgICAgICAgICAgICB2YWx1ZTogcmVzdWx0LnN0YXR1cyA9PT0gXCJ2YWxpZFwiXG4gICAgICAgICAgICAgICAgICAgID8gcmVzdWx0LnZhbHVlXG4gICAgICAgICAgICAgICAgICAgIDogdGhpcy5fZGVmLmNhdGNoVmFsdWUoe1xuICAgICAgICAgICAgICAgICAgICAgICAgZ2V0IGVycm9yKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXcgWm9kRXJyb3IobmV3Q3R4LmNvbW1vbi5pc3N1ZXMpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGlucHV0OiBuZXdDdHguZGF0YSxcbiAgICAgICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgfVxuICAgIHJlbW92ZUNhdGNoKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fZGVmLmlubmVyVHlwZTtcbiAgICB9XG59XG5ab2RDYXRjaC5jcmVhdGUgPSAodHlwZSwgcGFyYW1zKSA9PiB7XG4gICAgcmV0dXJuIG5ldyBab2RDYXRjaCh7XG4gICAgICAgIGlubmVyVHlwZTogdHlwZSxcbiAgICAgICAgdHlwZU5hbWU6IFpvZEZpcnN0UGFydHlUeXBlS2luZC5ab2RDYXRjaCxcbiAgICAgICAgY2F0Y2hWYWx1ZTogdHlwZW9mIHBhcmFtcy5jYXRjaCA9PT0gXCJmdW5jdGlvblwiID8gcGFyYW1zLmNhdGNoIDogKCkgPT4gcGFyYW1zLmNhdGNoLFxuICAgICAgICAuLi5wcm9jZXNzQ3JlYXRlUGFyYW1zKHBhcmFtcyksXG4gICAgfSk7XG59O1xuZXhwb3J0IGNsYXNzIFpvZE5hTiBleHRlbmRzIFpvZFR5cGUge1xuICAgIF9wYXJzZShpbnB1dCkge1xuICAgICAgICBjb25zdCBwYXJzZWRUeXBlID0gdGhpcy5fZ2V0VHlwZShpbnB1dCk7XG4gICAgICAgIGlmIChwYXJzZWRUeXBlICE9PSBab2RQYXJzZWRUeXBlLm5hbikge1xuICAgICAgICAgICAgY29uc3QgY3R4ID0gdGhpcy5fZ2V0T3JSZXR1cm5DdHgoaW5wdXQpO1xuICAgICAgICAgICAgYWRkSXNzdWVUb0NvbnRleHQoY3R4LCB7XG4gICAgICAgICAgICAgICAgY29kZTogWm9kSXNzdWVDb2RlLmludmFsaWRfdHlwZSxcbiAgICAgICAgICAgICAgICBleHBlY3RlZDogWm9kUGFyc2VkVHlwZS5uYW4sXG4gICAgICAgICAgICAgICAgcmVjZWl2ZWQ6IGN0eC5wYXJzZWRUeXBlLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gSU5WQUxJRDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4geyBzdGF0dXM6IFwidmFsaWRcIiwgdmFsdWU6IGlucHV0LmRhdGEgfTtcbiAgICB9XG59XG5ab2ROYU4uY3JlYXRlID0gKHBhcmFtcykgPT4ge1xuICAgIHJldHVybiBuZXcgWm9kTmFOKHtcbiAgICAgICAgdHlwZU5hbWU6IFpvZEZpcnN0UGFydHlUeXBlS2luZC5ab2ROYU4sXG4gICAgICAgIC4uLnByb2Nlc3NDcmVhdGVQYXJhbXMocGFyYW1zKSxcbiAgICB9KTtcbn07XG5leHBvcnQgY29uc3QgQlJBTkQgPSBTeW1ib2woXCJ6b2RfYnJhbmRcIik7XG5leHBvcnQgY2xhc3MgWm9kQnJhbmRlZCBleHRlbmRzIFpvZFR5cGUge1xuICAgIF9wYXJzZShpbnB1dCkge1xuICAgICAgICBjb25zdCB7IGN0eCB9ID0gdGhpcy5fcHJvY2Vzc0lucHV0UGFyYW1zKGlucHV0KTtcbiAgICAgICAgY29uc3QgZGF0YSA9IGN0eC5kYXRhO1xuICAgICAgICByZXR1cm4gdGhpcy5fZGVmLnR5cGUuX3BhcnNlKHtcbiAgICAgICAgICAgIGRhdGEsXG4gICAgICAgICAgICBwYXRoOiBjdHgucGF0aCxcbiAgICAgICAgICAgIHBhcmVudDogY3R4LFxuICAgICAgICB9KTtcbiAgICB9XG4gICAgdW53cmFwKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fZGVmLnR5cGU7XG4gICAgfVxufVxuZXhwb3J0IGNsYXNzIFpvZFBpcGVsaW5lIGV4dGVuZHMgWm9kVHlwZSB7XG4gICAgX3BhcnNlKGlucHV0KSB7XG4gICAgICAgIGNvbnN0IHsgc3RhdHVzLCBjdHggfSA9IHRoaXMuX3Byb2Nlc3NJbnB1dFBhcmFtcyhpbnB1dCk7XG4gICAgICAgIGlmIChjdHguY29tbW9uLmFzeW5jKSB7XG4gICAgICAgICAgICBjb25zdCBoYW5kbGVBc3luYyA9IGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBpblJlc3VsdCA9IGF3YWl0IHRoaXMuX2RlZi5pbi5fcGFyc2VBc3luYyh7XG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IGN0eC5kYXRhLFxuICAgICAgICAgICAgICAgICAgICBwYXRoOiBjdHgucGF0aCxcbiAgICAgICAgICAgICAgICAgICAgcGFyZW50OiBjdHgsXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgaWYgKGluUmVzdWx0LnN0YXR1cyA9PT0gXCJhYm9ydGVkXCIpXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBJTlZBTElEO1xuICAgICAgICAgICAgICAgIGlmIChpblJlc3VsdC5zdGF0dXMgPT09IFwiZGlydHlcIikge1xuICAgICAgICAgICAgICAgICAgICBzdGF0dXMuZGlydHkoKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIERJUlRZKGluUmVzdWx0LnZhbHVlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLl9kZWYub3V0Ll9wYXJzZUFzeW5jKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRhdGE6IGluUmVzdWx0LnZhbHVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgcGF0aDogY3R4LnBhdGgsXG4gICAgICAgICAgICAgICAgICAgICAgICBwYXJlbnQ6IGN0eCxcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIHJldHVybiBoYW5kbGVBc3luYygpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgY29uc3QgaW5SZXN1bHQgPSB0aGlzLl9kZWYuaW4uX3BhcnNlU3luYyh7XG4gICAgICAgICAgICAgICAgZGF0YTogY3R4LmRhdGEsXG4gICAgICAgICAgICAgICAgcGF0aDogY3R4LnBhdGgsXG4gICAgICAgICAgICAgICAgcGFyZW50OiBjdHgsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGlmIChpblJlc3VsdC5zdGF0dXMgPT09IFwiYWJvcnRlZFwiKVxuICAgICAgICAgICAgICAgIHJldHVybiBJTlZBTElEO1xuICAgICAgICAgICAgaWYgKGluUmVzdWx0LnN0YXR1cyA9PT0gXCJkaXJ0eVwiKSB7XG4gICAgICAgICAgICAgICAgc3RhdHVzLmRpcnR5KCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiBcImRpcnR5XCIsXG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiBpblJlc3VsdC52YWx1ZSxcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2RlZi5vdXQuX3BhcnNlU3luYyh7XG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IGluUmVzdWx0LnZhbHVlLFxuICAgICAgICAgICAgICAgICAgICBwYXRoOiBjdHgucGF0aCxcbiAgICAgICAgICAgICAgICAgICAgcGFyZW50OiBjdHgsXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgc3RhdGljIGNyZWF0ZShhLCBiKSB7XG4gICAgICAgIHJldHVybiBuZXcgWm9kUGlwZWxpbmUoe1xuICAgICAgICAgICAgaW46IGEsXG4gICAgICAgICAgICBvdXQ6IGIsXG4gICAgICAgICAgICB0eXBlTmFtZTogWm9kRmlyc3RQYXJ0eVR5cGVLaW5kLlpvZFBpcGVsaW5lLFxuICAgICAgICB9KTtcbiAgICB9XG59XG5leHBvcnQgY2xhc3MgWm9kUmVhZG9ubHkgZXh0ZW5kcyBab2RUeXBlIHtcbiAgICBfcGFyc2UoaW5wdXQpIHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gdGhpcy5fZGVmLmlubmVyVHlwZS5fcGFyc2UoaW5wdXQpO1xuICAgICAgICBjb25zdCBmcmVlemUgPSAoZGF0YSkgPT4ge1xuICAgICAgICAgICAgaWYgKGlzVmFsaWQoZGF0YSkpIHtcbiAgICAgICAgICAgICAgICBkYXRhLnZhbHVlID0gT2JqZWN0LmZyZWV6ZShkYXRhLnZhbHVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBkYXRhO1xuICAgICAgICB9O1xuICAgICAgICByZXR1cm4gaXNBc3luYyhyZXN1bHQpID8gcmVzdWx0LnRoZW4oKGRhdGEpID0+IGZyZWV6ZShkYXRhKSkgOiBmcmVlemUocmVzdWx0KTtcbiAgICB9XG4gICAgdW53cmFwKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fZGVmLmlubmVyVHlwZTtcbiAgICB9XG59XG5ab2RSZWFkb25seS5jcmVhdGUgPSAodHlwZSwgcGFyYW1zKSA9PiB7XG4gICAgcmV0dXJuIG5ldyBab2RSZWFkb25seSh7XG4gICAgICAgIGlubmVyVHlwZTogdHlwZSxcbiAgICAgICAgdHlwZU5hbWU6IFpvZEZpcnN0UGFydHlUeXBlS2luZC5ab2RSZWFkb25seSxcbiAgICAgICAgLi4ucHJvY2Vzc0NyZWF0ZVBhcmFtcyhwYXJhbXMpLFxuICAgIH0pO1xufTtcbi8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cbi8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cbi8vLy8vLy8vLy8gICAgICAgICAgICAgICAgICAgIC8vLy8vLy8vLy9cbi8vLy8vLy8vLy8gICAgICB6LmN1c3RvbSAgICAgIC8vLy8vLy8vLy9cbi8vLy8vLy8vLy8gICAgICAgICAgICAgICAgICAgIC8vLy8vLy8vLy9cbi8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cbi8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cbmZ1bmN0aW9uIGNsZWFuUGFyYW1zKHBhcmFtcywgZGF0YSkge1xuICAgIGNvbnN0IHAgPSB0eXBlb2YgcGFyYW1zID09PSBcImZ1bmN0aW9uXCIgPyBwYXJhbXMoZGF0YSkgOiB0eXBlb2YgcGFyYW1zID09PSBcInN0cmluZ1wiID8geyBtZXNzYWdlOiBwYXJhbXMgfSA6IHBhcmFtcztcbiAgICBjb25zdCBwMiA9IHR5cGVvZiBwID09PSBcInN0cmluZ1wiID8geyBtZXNzYWdlOiBwIH0gOiBwO1xuICAgIHJldHVybiBwMjtcbn1cbmV4cG9ydCBmdW5jdGlvbiBjdXN0b20oY2hlY2ssIF9wYXJhbXMgPSB7fSwgXG4vKipcbiAqIEBkZXByZWNhdGVkXG4gKlxuICogUGFzcyBgZmF0YWxgIGludG8gdGhlIHBhcmFtcyBvYmplY3QgaW5zdGVhZDpcbiAqXG4gKiBgYGB0c1xuICogei5zdHJpbmcoKS5jdXN0b20oKHZhbCkgPT4gdmFsLmxlbmd0aCA+IDUsIHsgZmF0YWw6IGZhbHNlIH0pXG4gKiBgYGBcbiAqXG4gKi9cbmZhdGFsKSB7XG4gICAgaWYgKGNoZWNrKVxuICAgICAgICByZXR1cm4gWm9kQW55LmNyZWF0ZSgpLnN1cGVyUmVmaW5lKChkYXRhLCBjdHgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHIgPSBjaGVjayhkYXRhKTtcbiAgICAgICAgICAgIGlmIChyIGluc3RhbmNlb2YgUHJvbWlzZSkge1xuICAgICAgICAgICAgICAgIHJldHVybiByLnRoZW4oKHIpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwYXJhbXMgPSBjbGVhblBhcmFtcyhfcGFyYW1zLCBkYXRhKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IF9mYXRhbCA9IHBhcmFtcy5mYXRhbCA/PyBmYXRhbCA/PyB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgY3R4LmFkZElzc3VlKHsgY29kZTogXCJjdXN0b21cIiwgLi4ucGFyYW1zLCBmYXRhbDogX2ZhdGFsIH0pO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIXIpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBwYXJhbXMgPSBjbGVhblBhcmFtcyhfcGFyYW1zLCBkYXRhKTtcbiAgICAgICAgICAgICAgICBjb25zdCBfZmF0YWwgPSBwYXJhbXMuZmF0YWwgPz8gZmF0YWwgPz8gdHJ1ZTtcbiAgICAgICAgICAgICAgICBjdHguYWRkSXNzdWUoeyBjb2RlOiBcImN1c3RvbVwiLCAuLi5wYXJhbXMsIGZhdGFsOiBfZmF0YWwgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH0pO1xuICAgIHJldHVybiBab2RBbnkuY3JlYXRlKCk7XG59XG5leHBvcnQgeyBab2RUeXBlIGFzIFNjaGVtYSwgWm9kVHlwZSBhcyBab2RTY2hlbWEgfTtcbmV4cG9ydCBjb25zdCBsYXRlID0ge1xuICAgIG9iamVjdDogWm9kT2JqZWN0LmxhenljcmVhdGUsXG59O1xuZXhwb3J0IHZhciBab2RGaXJzdFBhcnR5VHlwZUtpbmQ7XG4oZnVuY3Rpb24gKFpvZEZpcnN0UGFydHlUeXBlS2luZCkge1xuICAgIFpvZEZpcnN0UGFydHlUeXBlS2luZFtcIlpvZFN0cmluZ1wiXSA9IFwiWm9kU3RyaW5nXCI7XG4gICAgWm9kRmlyc3RQYXJ0eVR5cGVLaW5kW1wiWm9kTnVtYmVyXCJdID0gXCJab2ROdW1iZXJcIjtcbiAgICBab2RGaXJzdFBhcnR5VHlwZUtpbmRbXCJab2ROYU5cIl0gPSBcIlpvZE5hTlwiO1xuICAgIFpvZEZpcnN0UGFydHlUeXBlS2luZFtcIlpvZEJpZ0ludFwiXSA9IFwiWm9kQmlnSW50XCI7XG4gICAgWm9kRmlyc3RQYXJ0eVR5cGVLaW5kW1wiWm9kQm9vbGVhblwiXSA9IFwiWm9kQm9vbGVhblwiO1xuICAgIFpvZEZpcnN0UGFydHlUeXBlS2luZFtcIlpvZERhdGVcIl0gPSBcIlpvZERhdGVcIjtcbiAgICBab2RGaXJzdFBhcnR5VHlwZUtpbmRbXCJab2RTeW1ib2xcIl0gPSBcIlpvZFN5bWJvbFwiO1xuICAgIFpvZEZpcnN0UGFydHlUeXBlS2luZFtcIlpvZFVuZGVmaW5lZFwiXSA9IFwiWm9kVW5kZWZpbmVkXCI7XG4gICAgWm9kRmlyc3RQYXJ0eVR5cGVLaW5kW1wiWm9kTnVsbFwiXSA9IFwiWm9kTnVsbFwiO1xuICAgIFpvZEZpcnN0UGFydHlUeXBlS2luZFtcIlpvZEFueVwiXSA9IFwiWm9kQW55XCI7XG4gICAgWm9kRmlyc3RQYXJ0eVR5cGVLaW5kW1wiWm9kVW5rbm93blwiXSA9IFwiWm9kVW5rbm93blwiO1xuICAgIFpvZEZpcnN0UGFydHlUeXBlS2luZFtcIlpvZE5ldmVyXCJdID0gXCJab2ROZXZlclwiO1xuICAgIFpvZEZpcnN0UGFydHlUeXBlS2luZFtcIlpvZFZvaWRcIl0gPSBcIlpvZFZvaWRcIjtcbiAgICBab2RGaXJzdFBhcnR5VHlwZUtpbmRbXCJab2RBcnJheVwiXSA9IFwiWm9kQXJyYXlcIjtcbiAgICBab2RGaXJzdFBhcnR5VHlwZUtpbmRbXCJab2RPYmplY3RcIl0gPSBcIlpvZE9iamVjdFwiO1xuICAgIFpvZEZpcnN0UGFydHlUeXBlS2luZFtcIlpvZFVuaW9uXCJdID0gXCJab2RVbmlvblwiO1xuICAgIFpvZEZpcnN0UGFydHlUeXBlS2luZFtcIlpvZERpc2NyaW1pbmF0ZWRVbmlvblwiXSA9IFwiWm9kRGlzY3JpbWluYXRlZFVuaW9uXCI7XG4gICAgWm9kRmlyc3RQYXJ0eVR5cGVLaW5kW1wiWm9kSW50ZXJzZWN0aW9uXCJdID0gXCJab2RJbnRlcnNlY3Rpb25cIjtcbiAgICBab2RGaXJzdFBhcnR5VHlwZUtpbmRbXCJab2RUdXBsZVwiXSA9IFwiWm9kVHVwbGVcIjtcbiAgICBab2RGaXJzdFBhcnR5VHlwZUtpbmRbXCJab2RSZWNvcmRcIl0gPSBcIlpvZFJlY29yZFwiO1xuICAgIFpvZEZpcnN0UGFydHlUeXBlS2luZFtcIlpvZE1hcFwiXSA9IFwiWm9kTWFwXCI7XG4gICAgWm9kRmlyc3RQYXJ0eVR5cGVLaW5kW1wiWm9kU2V0XCJdID0gXCJab2RTZXRcIjtcbiAgICBab2RGaXJzdFBhcnR5VHlwZUtpbmRbXCJab2RGdW5jdGlvblwiXSA9IFwiWm9kRnVuY3Rpb25cIjtcbiAgICBab2RGaXJzdFBhcnR5VHlwZUtpbmRbXCJab2RMYXp5XCJdID0gXCJab2RMYXp5XCI7XG4gICAgWm9kRmlyc3RQYXJ0eVR5cGVLaW5kW1wiWm9kTGl0ZXJhbFwiXSA9IFwiWm9kTGl0ZXJhbFwiO1xuICAgIFpvZEZpcnN0UGFydHlUeXBlS2luZFtcIlpvZEVudW1cIl0gPSBcIlpvZEVudW1cIjtcbiAgICBab2RGaXJzdFBhcnR5VHlwZUtpbmRbXCJab2RFZmZlY3RzXCJdID0gXCJab2RFZmZlY3RzXCI7XG4gICAgWm9kRmlyc3RQYXJ0eVR5cGVLaW5kW1wiWm9kTmF0aXZlRW51bVwiXSA9IFwiWm9kTmF0aXZlRW51bVwiO1xuICAgIFpvZEZpcnN0UGFydHlUeXBlS2luZFtcIlpvZE9wdGlvbmFsXCJdID0gXCJab2RPcHRpb25hbFwiO1xuICAgIFpvZEZpcnN0UGFydHlUeXBlS2luZFtcIlpvZE51bGxhYmxlXCJdID0gXCJab2ROdWxsYWJsZVwiO1xuICAgIFpvZEZpcnN0UGFydHlUeXBlS2luZFtcIlpvZERlZmF1bHRcIl0gPSBcIlpvZERlZmF1bHRcIjtcbiAgICBab2RGaXJzdFBhcnR5VHlwZUtpbmRbXCJab2RDYXRjaFwiXSA9IFwiWm9kQ2F0Y2hcIjtcbiAgICBab2RGaXJzdFBhcnR5VHlwZUtpbmRbXCJab2RQcm9taXNlXCJdID0gXCJab2RQcm9taXNlXCI7XG4gICAgWm9kRmlyc3RQYXJ0eVR5cGVLaW5kW1wiWm9kQnJhbmRlZFwiXSA9IFwiWm9kQnJhbmRlZFwiO1xuICAgIFpvZEZpcnN0UGFydHlUeXBlS2luZFtcIlpvZFBpcGVsaW5lXCJdID0gXCJab2RQaXBlbGluZVwiO1xuICAgIFpvZEZpcnN0UGFydHlUeXBlS2luZFtcIlpvZFJlYWRvbmx5XCJdID0gXCJab2RSZWFkb25seVwiO1xufSkoWm9kRmlyc3RQYXJ0eVR5cGVLaW5kIHx8IChab2RGaXJzdFBhcnR5VHlwZUtpbmQgPSB7fSkpO1xuLy8gcmVxdWlyZXMgVFMgNC40K1xuY2xhc3MgQ2xhc3Mge1xuICAgIGNvbnN0cnVjdG9yKC4uLl8pIHsgfVxufVxuY29uc3QgaW5zdGFuY2VPZlR5cGUgPSAoXG4vLyBjb25zdCBpbnN0YW5jZU9mVHlwZSA9IDxUIGV4dGVuZHMgbmV3ICguLi5hcmdzOiBhbnlbXSkgPT4gYW55PihcbmNscywgcGFyYW1zID0ge1xuICAgIG1lc3NhZ2U6IGBJbnB1dCBub3QgaW5zdGFuY2Ugb2YgJHtjbHMubmFtZX1gLFxufSkgPT4gY3VzdG9tKChkYXRhKSA9PiBkYXRhIGluc3RhbmNlb2YgY2xzLCBwYXJhbXMpO1xuY29uc3Qgc3RyaW5nVHlwZSA9IFpvZFN0cmluZy5jcmVhdGU7XG5jb25zdCBudW1iZXJUeXBlID0gWm9kTnVtYmVyLmNyZWF0ZTtcbmNvbnN0IG5hblR5cGUgPSBab2ROYU4uY3JlYXRlO1xuY29uc3QgYmlnSW50VHlwZSA9IFpvZEJpZ0ludC5jcmVhdGU7XG5jb25zdCBib29sZWFuVHlwZSA9IFpvZEJvb2xlYW4uY3JlYXRlO1xuY29uc3QgZGF0ZVR5cGUgPSBab2REYXRlLmNyZWF0ZTtcbmNvbnN0IHN5bWJvbFR5cGUgPSBab2RTeW1ib2wuY3JlYXRlO1xuY29uc3QgdW5kZWZpbmVkVHlwZSA9IFpvZFVuZGVmaW5lZC5jcmVhdGU7XG5jb25zdCBudWxsVHlwZSA9IFpvZE51bGwuY3JlYXRlO1xuY29uc3QgYW55VHlwZSA9IFpvZEFueS5jcmVhdGU7XG5jb25zdCB1bmtub3duVHlwZSA9IFpvZFVua25vd24uY3JlYXRlO1xuY29uc3QgbmV2ZXJUeXBlID0gWm9kTmV2ZXIuY3JlYXRlO1xuY29uc3Qgdm9pZFR5cGUgPSBab2RWb2lkLmNyZWF0ZTtcbmNvbnN0IGFycmF5VHlwZSA9IFpvZEFycmF5LmNyZWF0ZTtcbmNvbnN0IG9iamVjdFR5cGUgPSBab2RPYmplY3QuY3JlYXRlO1xuY29uc3Qgc3RyaWN0T2JqZWN0VHlwZSA9IFpvZE9iamVjdC5zdHJpY3RDcmVhdGU7XG5jb25zdCB1bmlvblR5cGUgPSBab2RVbmlvbi5jcmVhdGU7XG5jb25zdCBkaXNjcmltaW5hdGVkVW5pb25UeXBlID0gWm9kRGlzY3JpbWluYXRlZFVuaW9uLmNyZWF0ZTtcbmNvbnN0IGludGVyc2VjdGlvblR5cGUgPSBab2RJbnRlcnNlY3Rpb24uY3JlYXRlO1xuY29uc3QgdHVwbGVUeXBlID0gWm9kVHVwbGUuY3JlYXRlO1xuY29uc3QgcmVjb3JkVHlwZSA9IFpvZFJlY29yZC5jcmVhdGU7XG5jb25zdCBtYXBUeXBlID0gWm9kTWFwLmNyZWF0ZTtcbmNvbnN0IHNldFR5cGUgPSBab2RTZXQuY3JlYXRlO1xuY29uc3QgZnVuY3Rpb25UeXBlID0gWm9kRnVuY3Rpb24uY3JlYXRlO1xuY29uc3QgbGF6eVR5cGUgPSBab2RMYXp5LmNyZWF0ZTtcbmNvbnN0IGxpdGVyYWxUeXBlID0gWm9kTGl0ZXJhbC5jcmVhdGU7XG5jb25zdCBlbnVtVHlwZSA9IFpvZEVudW0uY3JlYXRlO1xuY29uc3QgbmF0aXZlRW51bVR5cGUgPSBab2ROYXRpdmVFbnVtLmNyZWF0ZTtcbmNvbnN0IHByb21pc2VUeXBlID0gWm9kUHJvbWlzZS5jcmVhdGU7XG5jb25zdCBlZmZlY3RzVHlwZSA9IFpvZEVmZmVjdHMuY3JlYXRlO1xuY29uc3Qgb3B0aW9uYWxUeXBlID0gWm9kT3B0aW9uYWwuY3JlYXRlO1xuY29uc3QgbnVsbGFibGVUeXBlID0gWm9kTnVsbGFibGUuY3JlYXRlO1xuY29uc3QgcHJlcHJvY2Vzc1R5cGUgPSBab2RFZmZlY3RzLmNyZWF0ZVdpdGhQcmVwcm9jZXNzO1xuY29uc3QgcGlwZWxpbmVUeXBlID0gWm9kUGlwZWxpbmUuY3JlYXRlO1xuY29uc3Qgb3N0cmluZyA9ICgpID0+IHN0cmluZ1R5cGUoKS5vcHRpb25hbCgpO1xuY29uc3Qgb251bWJlciA9ICgpID0+IG51bWJlclR5cGUoKS5vcHRpb25hbCgpO1xuY29uc3Qgb2Jvb2xlYW4gPSAoKSA9PiBib29sZWFuVHlwZSgpLm9wdGlvbmFsKCk7XG5leHBvcnQgY29uc3QgY29lcmNlID0ge1xuICAgIHN0cmluZzogKChhcmcpID0+IFpvZFN0cmluZy5jcmVhdGUoeyAuLi5hcmcsIGNvZXJjZTogdHJ1ZSB9KSksXG4gICAgbnVtYmVyOiAoKGFyZykgPT4gWm9kTnVtYmVyLmNyZWF0ZSh7IC4uLmFyZywgY29lcmNlOiB0cnVlIH0pKSxcbiAgICBib29sZWFuOiAoKGFyZykgPT4gWm9kQm9vbGVhbi5jcmVhdGUoe1xuICAgICAgICAuLi5hcmcsXG4gICAgICAgIGNvZXJjZTogdHJ1ZSxcbiAgICB9KSksXG4gICAgYmlnaW50OiAoKGFyZykgPT4gWm9kQmlnSW50LmNyZWF0ZSh7IC4uLmFyZywgY29lcmNlOiB0cnVlIH0pKSxcbiAgICBkYXRlOiAoKGFyZykgPT4gWm9kRGF0ZS5jcmVhdGUoeyAuLi5hcmcsIGNvZXJjZTogdHJ1ZSB9KSksXG59O1xuZXhwb3J0IHsgYW55VHlwZSBhcyBhbnksIGFycmF5VHlwZSBhcyBhcnJheSwgYmlnSW50VHlwZSBhcyBiaWdpbnQsIGJvb2xlYW5UeXBlIGFzIGJvb2xlYW4sIGRhdGVUeXBlIGFzIGRhdGUsIGRpc2NyaW1pbmF0ZWRVbmlvblR5cGUgYXMgZGlzY3JpbWluYXRlZFVuaW9uLCBlZmZlY3RzVHlwZSBhcyBlZmZlY3QsIGVudW1UeXBlIGFzIGVudW0sIGZ1bmN0aW9uVHlwZSBhcyBmdW5jdGlvbiwgaW5zdGFuY2VPZlR5cGUgYXMgaW5zdGFuY2VvZiwgaW50ZXJzZWN0aW9uVHlwZSBhcyBpbnRlcnNlY3Rpb24sIGxhenlUeXBlIGFzIGxhenksIGxpdGVyYWxUeXBlIGFzIGxpdGVyYWwsIG1hcFR5cGUgYXMgbWFwLCBuYW5UeXBlIGFzIG5hbiwgbmF0aXZlRW51bVR5cGUgYXMgbmF0aXZlRW51bSwgbmV2ZXJUeXBlIGFzIG5ldmVyLCBudWxsVHlwZSBhcyBudWxsLCBudWxsYWJsZVR5cGUgYXMgbnVsbGFibGUsIG51bWJlclR5cGUgYXMgbnVtYmVyLCBvYmplY3RUeXBlIGFzIG9iamVjdCwgb2Jvb2xlYW4sIG9udW1iZXIsIG9wdGlvbmFsVHlwZSBhcyBvcHRpb25hbCwgb3N0cmluZywgcGlwZWxpbmVUeXBlIGFzIHBpcGVsaW5lLCBwcmVwcm9jZXNzVHlwZSBhcyBwcmVwcm9jZXNzLCBwcm9taXNlVHlwZSBhcyBwcm9taXNlLCByZWNvcmRUeXBlIGFzIHJlY29yZCwgc2V0VHlwZSBhcyBzZXQsIHN0cmljdE9iamVjdFR5cGUgYXMgc3RyaWN0T2JqZWN0LCBzdHJpbmdUeXBlIGFzIHN0cmluZywgc3ltYm9sVHlwZSBhcyBzeW1ib2wsIGVmZmVjdHNUeXBlIGFzIHRyYW5zZm9ybWVyLCB0dXBsZVR5cGUgYXMgdHVwbGUsIHVuZGVmaW5lZFR5cGUgYXMgdW5kZWZpbmVkLCB1bmlvblR5cGUgYXMgdW5pb24sIHVua25vd25UeXBlIGFzIHVua25vd24sIHZvaWRUeXBlIGFzIHZvaWQsIH07XG5leHBvcnQgY29uc3QgTkVWRVIgPSBJTlZBTElEO1xuIiwiaW1wb3J0IHsgeiB9IGZyb20gJ3pvZCdcblxuY29uc3QgcGFyYW1TY2hlbWEgPSB6Lm9iamVjdCh7XG4gIHR5cGU6IHoubGl0ZXJhbCgnbnVtYmVyJyksXG4gIHZhbHVlOiB6Lm51bWJlcigpLFxuICBtYXg6IHoubnVtYmVyKCksXG4gIG1pbjogei5udW1iZXIoKSxcbiAgZXhwb25lbnQ6IHoubnVtYmVyKCkub3B0aW9uYWwoKS5kZWZhdWx0KDEpXG59KVxuXG5leHBvcnQgY29uc3QgaW5wdXRTY2hlbWEgPSB6Lm9iamVjdCh7XG4gIHBhcmFtczogei5yZWNvcmQoei5zdHJpbmcoKSwgcGFyYW1TY2hlbWEpLFxuICBwcmVzZXRzOiB6LnJlY29yZCh6LnN0cmluZygpLCB6LnJlY29yZCh6LnN0cmluZygpLCBwYXJhbVNjaGVtYSkpXG59KVxuXG5leHBvcnQgdHlwZSBJbnB1dFNjaGVtYSA9IHouaW5mZXI8dHlwZW9mIGlucHV0U2NoZW1hPlxuIiwiaW1wb3J0IHsgcmVhZEZpbGUgfSBmcm9tICdmcy9wcm9taXNlcydcbmltcG9ydCB7IENsaWVudCwgU2VydmVyIH0gZnJvbSAnbm9kZS1vc2MnXG5pbXBvcnQgeyBleHRuYW1lIH0gZnJvbSAncGF0aCdcbmltcG9ydCBzaGFycCBmcm9tICdzaGFycCdcbmltcG9ydCB7IFNvY2tldCwgU2VydmVyIGFzIFNvY2tldElPU2VydmVyIH0gZnJvbSAnc29ja2V0LmlvJ1xuaW1wb3J0IHsgUmVjZWl2ZU1hcCwgU2VuZE1hcCB9IGZyb20gJ3NyYy90eXBlcydcbmltcG9ydCBzYyBmcm9tICdzdXBlcmNvbGxpZGVyanMnXG5pbXBvcnQgeyBJbnB1dFNjaGVtYSwgaW5wdXRTY2hlbWEgfSBmcm9tICcuL2lucHV0U2NoZW1hJ1xuXG5sZXQgc2NoZW1hU3RhdGU6IElucHV0U2NoZW1hID0ge1xuICBwYXJhbXM6IHt9LFxuICBwcmVzZXRzOiB7fVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc3RhcnREZXZTZXJ2ZXIoKSB7XG4gIC8vIGNvbnN0IHNlcnZlciA9IGF3YWl0IGNyZWF0ZVNlcnZlcih7XG4gIC8vICAgLy8gY29uZmlnIG9wdGlvbnNcbiAgLy8gICBwbHVnaW5zOiBbcmVhY3QoKSwgdGFpbHdpbmRjc3MoKV0sXG4gIC8vICAgcmVzb2x2ZToge1xuICAvLyAgICAgYWxpYXM6IHtcbiAgLy8gICAgICAgJ0AnOiByZXNvbHZlKGltcG9ydC5tZXRhLmRpcm5hbWUsICcuL3NyYycpXG4gIC8vICAgICB9XG4gIC8vICAgfSxcbiAgLy8gICB3b3JrZXI6IHtcbiAgLy8gICAgIGZvcm1hdDogJ2VzJyAvLyBVc2UgRVMgbW9kdWxlcyBmb3Igd29ya2Vyc1xuICAvLyAgIH0sXG4gIC8vICAgc2VydmVyOiB7XG4gIC8vICAgICBwb3J0OiAzMDAwLFxuICAvLyAgICAgaG9zdDogJzAuMC4wLjAnXG4gIC8vICAgfVxuICAvLyB9KVxuXG4gIC8vIC8vIENyZWF0ZSBTb2NrZXQuSU8gc2VydmVyXG4gIC8vIGNvbnN0IGh0dHBTZXJ2ZXIgPSBzZXJ2ZXIuaHR0cFNlcnZlclxuICAvLyBpbnZhcmlhbnQoaHR0cFNlcnZlcilcbiAgY29uc3QgaW8gPSBuZXcgU29ja2V0SU9TZXJ2ZXIoMzAwMCwge1xuICAgIGNvcnM6IHtcbiAgICAgIG9yaWdpbjogJyonLFxuICAgICAgbWV0aG9kczogWydHRVQnLCAnUE9TVCddXG4gICAgfVxuICB9KVxuXG4gIGxldCBzY1NlcnZlcjogYW55ID0gbnVsbFxuXG4gIC8vIEB0cy1pZ25vcmVcbiAgc2Muc2VydmVyLmJvb3QoKS50aGVuKFxuICAgIGFzeW5jIHRoaXNTZXJ2ZXIgPT4ge1xuICAgICAgc2NTZXJ2ZXIgPSB0aGlzU2VydmVyXG4gICAgICBjb25zb2xlLmxvZygn4pyFIFN1cGVyQ29sbGlkZXIgc2VydmVyIHN0YXJ0ZWQgc3VjY2Vzc2Z1bGx5JylcbiAgICB9LFxuICAgIGVyciA9PiB7XG4gICAgICBjb25zb2xlLndhcm4oJ+KaoO+4jyBTdXBlckNvbGxpZGVyIHNlcnZlciBmYWlsZWQgdG8gc3RhcnQ6JywgZXJyLm1lc3NhZ2UpXG4gICAgICBjb25zb2xlLmxvZygn8J+UhCBDb250aW51aW5nIHdpdGhvdXQgU3VwZXJDb2xsaWRlciBzZXJ2ZXIuLi4nKVxuICAgICAgc2NTZXJ2ZXIgPSBudWxsXG4gICAgfVxuICApXG5cbiAgY29uc3Qgc3ludGhzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge31cbiAgY29uc3Qgc3ludGhEZWZzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge31cblxuICBpby5vbignY29ubmVjdGlvbicsIChzb2NrZXQ6IFNvY2tldDxSZWNlaXZlTWFwLCBTZW5kTWFwPikgPT4ge1xuICAgIHNvY2tldC5lbWl0KCdwYXJhbXMnLCBzY2hlbWFTdGF0ZSlcblxuICAgIHNvY2tldC5vbigncGFyYW1zOnJlc2V0JywgKCkgPT4ge1xuICAgICAgc2NoZW1hU3RhdGUucGFyYW1zID0ge31cbiAgICB9KVxuICAgIHNvY2tldC5vbigncGFyYW1zJywgb2JqID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHNjaGVtYVN0YXRlID0geyAuLi5zY2hlbWFTdGF0ZSwgLi4uaW5wdXRTY2hlbWEucGFyc2Uob2JqKSB9XG4gICAgICAgIGlvLmVtaXQoJ3BhcmFtcycsIHNjaGVtYVN0YXRlKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCBwYXJhbXMgcmVjZWl2ZWQ6JywgZXJyb3IpXG4gICAgICB9XG4gICAgfSlcblxuICAgIHNvY2tldC5vbignc2M6c3ludGgnLCBhc3luYyAobmFtZTogc3RyaW5nLCBzeW50aERlZjogc3RyaW5nKSA9PiB7XG4gICAgICBpZiAoIXNjU2VydmVyKSByZXR1cm5cblxuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gQ29tcGlsZSBhIFN5bnRoRGVmIGZyb20gaW5saW5lIFN1cGVyQ29sbGlkZXIgbGFuZ3VhZ2UgY29kZSBhbmQgc2VuZCBpdCB0byB0aGUgc2VydmVyXG4gICAgICAgIGNvbnN0IGRlZiA9IGF3YWl0IHNjU2VydmVyLnN5bnRoRGVmKG5hbWUsIHN5bnRoRGVmKVxuICAgICAgICBzeW50aERlZnNbbmFtZV0gPSBkZWZcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBjb21waWxpbmcgU3ludGhEZWY6JywgZXJyKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cbiAgICB9KVxuXG4gICAgc29ja2V0Lm9uKCdzYzpzZXQnLCBhc3luYyAobmFtZTogc3RyaW5nLCBwYXJhbTogc3RyaW5nLCB2YWx1ZTogbnVtYmVyKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAoIXN5bnRoc1tuYW1lXSkgcmV0dXJuIGZhbHNlXG4gICAgICAgIHN5bnRoc1tuYW1lXS5zZXQoeyBbcGFyYW1dOiB2YWx1ZSB9KVxuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHNldHRpbmcgU3ludGggcGFyYW1ldGVyOicsIGVycilcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgc29ja2V0Lm9uKCdzYzpvbicsIGFzeW5jICgpID0+IHtcbiAgICAgIGZvciAobGV0IHN5bnRoIGluIHN5bnRoRGVmcykge1xuICAgICAgICBzeW50aHNbc3ludGhdID0gYXdhaXQgc2NTZXJ2ZXIuc3ludGgoc3ludGhEZWZzW3N5bnRoXSlcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgc29ja2V0Lm9uKCdzYzpvZmYnLCAoKSA9PiB7XG4gICAgICBmb3IgKGNvbnN0IGtleSBpbiBzeW50aHMpIHtcbiAgICAgICAgc3ludGhzW2tleV0uZnJlZSgpXG4gICAgICAgIGRlbGV0ZSBzeW50aHNba2V5XVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBzb2NrZXQub24oJ2ZpbGVzOmxvYWQnLCBhc3luYyAoZmlsZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4pID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGZpbGVzQml0bWFwczogUmVjb3JkPHN0cmluZywgSW1hZ2VCaXRtYXBbXT4gPSB7fVxuXG4gICAgICAgIGZvciAoY29uc3QgW25hbWUsIGZpbGVQYXRoXSBvZiBPYmplY3QuZW50cmllcyhmaWxlcykpIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgZmlsZURhdGEgPSBhd2FpdCByZWFkRmlsZShmaWxlUGF0aClcbiAgICAgICAgICAgIGNvbnN0IGV4dCA9IGV4dG5hbWUoZmlsZVBhdGgpLnRvTG93ZXJDYXNlKClcblxuICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICBbJy5qcGcnLCAnLmpwZWcnLCAnLnBuZycsICcuZ2lmJywgJy5ibXAnLCAnLndlYnAnXS5pbmNsdWRlcyhleHQpXG4gICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgLy8gSGFuZGxlIGltYWdlIGZpbGVzIHVzaW5nIHNoYXJwXG4gICAgICAgICAgICAgIGNvbnN0IGltYWdlQnVmZmVyID0gYXdhaXQgc2hhcnAoZmlsZURhdGEpXG4gICAgICAgICAgICAgICAgLnJhdygpXG4gICAgICAgICAgICAgICAgLnRvQnVmZmVyKHsgcmVzb2x2ZVdpdGhPYmplY3Q6IHRydWUgfSlcblxuICAgICAgICAgICAgICAvLyBDb252ZXJ0IHRvIEltYWdlRGF0YS1saWtlIHN0cnVjdHVyZSB0aGF0IGNhbiBiZSB0cmFuc2ZlcnJlZFxuICAgICAgICAgICAgICBjb25zdCBpbWFnZURhdGEgPSB7XG4gICAgICAgICAgICAgICAgZGF0YTogbmV3IFVpbnQ4Q2xhbXBlZEFycmF5KGltYWdlQnVmZmVyLmRhdGEpLFxuICAgICAgICAgICAgICAgIHdpZHRoOiBpbWFnZUJ1ZmZlci5pbmZvLndpZHRoLFxuICAgICAgICAgICAgICAgIGhlaWdodDogaW1hZ2VCdWZmZXIuaW5mby5oZWlnaHRcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIC8vIFNpbmNlIHdlIGNhbid0IGNyZWF0ZSBhY3R1YWwgSW1hZ2VCaXRtYXAgaW4gTm9kZS5qcyxcbiAgICAgICAgICAgICAgLy8gd2UnbGwgc2VuZCB0aGUgcmF3IGltYWdlIGRhdGEgYW5kIGxldCB0aGUgY2xpZW50IGhhbmRsZSBpdFxuICAgICAgICAgICAgICBmaWxlc0JpdG1hcHNbbmFtZV0gPSBbaW1hZ2VEYXRhIGFzIGFueV1cbiAgICAgICAgICAgIH0gZWxzZSBpZiAoWycubXA0JywgJy53ZWJtJywgJy5tb3YnLCAnLmF2aSddLmluY2x1ZGVzKGV4dCkpIHtcbiAgICAgICAgICAgICAgLy8gSGFuZGxlIHZpZGVvIGZpbGVzIChzaW1wbGlmaWVkIC0gd291bGQgbmVlZCBmZm1wZWcgZm9yIHByb3BlciBmcmFtZSBleHRyYWN0aW9uKVxuICAgICAgICAgICAgICAvLyBGb3Igbm93LCBza2lwIHZpZGVvIGZpbGVzIG9yIGhhbmRsZSB0aGVtIGRpZmZlcmVudGx5XG4gICAgICAgICAgICAgIGNvbnNvbGUubG9nKFxuICAgICAgICAgICAgICAgIGBWaWRlbyBmaWxlICR7ZmlsZVBhdGh9IGRldGVjdGVkIC0gdmlkZW8gcHJvY2Vzc2luZyBub3QgaW1wbGVtZW50ZWRgXG4gICAgICAgICAgICAgIClcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgbG9hZGluZyBmaWxlICR7ZmlsZVBhdGh9OmAsIGVycm9yKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHNvY2tldC5lbWl0KCdmaWxlczpsb2FkZWQnLCBmaWxlc0JpdG1hcHMpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBsb2FkaW5nIGZpbGVzOicsIGVycm9yKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBzb2NrZXQub24oJ2Rpc2Nvbm5lY3QnLCAoKSA9PiB7XG4gICAgICBjb25zb2xlLmxvZygnU29ja2V0LklPIGNsaWVudCBkaXNjb25uZWN0ZWQ6Jywgc29ja2V0LmlkKVxuICAgIH0pXG4gIH0pXG5cbiAgY29uc3Qgb3NjQ29uZmlnID0geyBwb3J0OiA1NzEyMSwgaG9zdDogJzEyNy4wLjAuMScgfVxuXG4gIC8vIENyZWF0ZSBPU0Mgc2VydmVyXG4gIGNvbnN0IG9zY1NlcnZlciA9IG5ldyBTZXJ2ZXIob3NjQ29uZmlnLnBvcnQsIG9zY0NvbmZpZy5ob3N0KVxuXG4gIC8vIENyZWF0ZSBPU0MgY2xpZW50IGZvciBzZW5kaW5nIG1lc3NhZ2VzXG4gIGNvbnN0IG9zY0NsaWVudCA9IG5ldyBDbGllbnQob3NjQ29uZmlnLmhvc3QsIG9zY0NvbmZpZy5wb3J0KVxuXG4gIG9zY1NlcnZlci5vbignbGlzdGVuaW5nJywgKCkgPT4ge1xuICAgIGNvbnNvbGUubG9nKFxuICAgICAgYPCfjrUgT1NDIFNlcnZlciBsaXN0ZW5pbmcgb24gJHtvc2NDb25maWcuaG9zdH06JHtvc2NDb25maWcucG9ydH1gXG4gICAgKVxuICB9KVxuXG4gIG9zY1NlcnZlci5vbignbWVzc2FnZScsIG1zZyA9PiB7XG4gICAgY29uc29sZS5sb2coJ/Cfk6ggT1NDIE1lc3NhZ2UgcmVjZWl2ZWQ6JywgbXNnKVxuICB9KVxuXG4gIG9zY1NlcnZlci5vbignZXJyb3InLCBlcnJvciA9PiB7XG4gICAgY29uc29sZS5lcnJvcign4p2MIE9TQyBTZXJ2ZXIgZXJyb3I6JywgZXJyb3IpXG4gIH0pXG5cbiAgb3NjU2VydmVyLm9uKCdtZXNzYWdlJywgbXNnID0+IHtcbiAgICBjb25zdCBbYWRkcmVzcywgLi4uYXJnc10gPSBtc2cgYXMgW3N0cmluZywgLi4uYW55W11dXG5cbiAgICBzd2l0Y2ggKGFkZHJlc3MpIHtcbiAgICAgIGNhc2UgJy9hc2VtaWMvcGFyYW0nOlxuICAgICAgICBjb25zb2xlLmxvZygn4pqZ77iPIFBhcmFtZXRlciB1cGRhdGU6JywgYXJncylcbiAgICAgICAgaW8uZW1pdCgnYXNlbWljOnBhcmFtJywgYXJncylcbiAgICAgICAgYnJlYWtcblxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgLy8gRm9yd2FyZCBhbGwgb3RoZXIgbWVzc2FnZXMgdG8gY2xpZW50c1xuICAgICAgICBpby5lbWl0KCdvc2M6bWVzc2FnZScsIHsgYWRkcmVzcywgZGF0YTogYXJncyB9KVxuICAgIH1cbiAgfSlcblxuICAvLyBhd2FpdCBzZXJ2ZXIubGlzdGVuKClcblxuICAvLyBzZXJ2ZXIucHJpbnRVcmxzKClcbn1cblxuLy8gc3RhcnREZXZTZXJ2ZXIoKVxuIiwiaW1wb3J0IHsgYXBwLCBCcm93c2VyV2luZG93LCBpcGNNYWluLCBkaWFsb2cgfSBmcm9tICdlbGVjdHJvbidcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICdub2RlOnVybCdcbmltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCdcbmltcG9ydCBmcyBmcm9tICdub2RlOmZzL3Byb21pc2VzJ1xuaW1wb3J0IHsgc3RhcnREZXZTZXJ2ZXIgfSBmcm9tICcuLi9zcmMvc2VydmVyL3NlcnZlcidcblxuY29uc3QgX19kaXJuYW1lID0gcGF0aC5kaXJuYW1lKGZpbGVVUkxUb1BhdGgoaW1wb3J0Lm1ldGEudXJsKSlcblxuLy8gVGhlIGJ1aWx0IGRpcmVjdG9yeSBzdHJ1Y3R1cmVcbi8vXG4vLyDilJzilIDilKzilIDilKwgZGlzdFxuLy8g4pSCIOKUgiDilJTilIDilIAgaW5kZXguaHRtbFxuLy8g4pSCIOKUglxuLy8g4pSCIOKUnOKUgOKUrCBkaXN0LWVsZWN0cm9uXG4vLyDilIIg4pSCIOKUnOKUgOKUgCBtYWluLmpzXG4vLyDilIIg4pSCIOKUlOKUgOKUgCBwcmVsb2FkLm1qc1xuLy8g4pSCXG5wcm9jZXNzLmVudi5BUFBfUk9PVCA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicpXG5cbmV4cG9ydCBjb25zdCBWSVRFX0RFVl9TRVJWRVJfVVJMID0gcHJvY2Vzcy5lbnZbJ1ZJVEVfREVWX1NFUlZFUl9VUkwnXVxuZXhwb3J0IGNvbnN0IE1BSU5fRElTVCA9IHBhdGguam9pbihwcm9jZXNzLmVudi5BUFBfUk9PVCwgJ2Rpc3QtZWxlY3Ryb24nKVxuZXhwb3J0IGNvbnN0IFJFTkRFUkVSX0RJU1QgPSBwYXRoLmpvaW4ocHJvY2Vzcy5lbnYuQVBQX1JPT1QsICdkaXN0JylcblxucHJvY2Vzcy5lbnYuVklURV9QVUJMSUMgPSBWSVRFX0RFVl9TRVJWRVJfVVJMXG4gID8gcGF0aC5qb2luKHByb2Nlc3MuZW52LkFQUF9ST09ULCAncHVibGljJylcbiAgOiBSRU5ERVJFUl9ESVNUXG5cbmxldCB3aW46IEJyb3dzZXJXaW5kb3cgfCBudWxsXG5cbmZ1bmN0aW9uIGNyZWF0ZVdpbmRvdygpIHtcbiAgd2luID0gbmV3IEJyb3dzZXJXaW5kb3coe1xuICAgIHdpZHRoOiAxMjAwLFxuICAgIGhlaWdodDogODAwLFxuICAgIGljb246IHByb2Nlc3MuZW52LlZJVEVfUFVCTElDXG4gICAgICA/IHBhdGguam9pbihwcm9jZXNzLmVudi5WSVRFX1BVQkxJQywgJ3ZpdGUuc3ZnJylcbiAgICAgIDogdW5kZWZpbmVkLFxuICAgIHdlYlByZWZlcmVuY2VzOiB7XG4gICAgICBwcmVsb2FkOiBwYXRoLmpvaW4oX19kaXJuYW1lLCAncHJlbG9hZC5tanMnKSxcbiAgICAgIG5vZGVJbnRlZ3JhdGlvbjogZmFsc2UsXG4gICAgICBjb250ZXh0SXNvbGF0aW9uOiB0cnVlXG4gICAgfVxuICB9KVxuXG4gIC8vIFRlc3QgYWN0aXZlIHB1c2ggbWVzc2FnZSB0byBSZW5kZXJlci1wcm9jZXNzLlxuICB3aW4ud2ViQ29udGVudHMub24oJ2RpZC1maW5pc2gtbG9hZCcsICgpID0+IHtcbiAgICB3aW4/LndlYkNvbnRlbnRzLnNlbmQoJ21haW4tcHJvY2Vzcy1tZXNzYWdlJywgbmV3IERhdGUoKS50b0xvY2FsZVN0cmluZygpKVxuICB9KVxuXG4gIGlmIChWSVRFX0RFVl9TRVJWRVJfVVJMKSB7XG4gICAgd2luLmxvYWRVUkwoVklURV9ERVZfU0VSVkVSX1VSTClcbiAgfSBlbHNlIHtcbiAgICAvLyB3aW4ubG9hZEZpbGUoJ2Rpc3QvaW5kZXguaHRtbCcpXG4gICAgd2luLmxvYWRGaWxlKHBhdGguam9pbihSRU5ERVJFUl9ESVNULCAnaW5kZXguaHRtbCcpKVxuICB9XG5cbiAgc3RhcnREZXZTZXJ2ZXIoKVxufVxuXG4vLyBRdWl0IHdoZW4gYWxsIHdpbmRvd3MgYXJlIGNsb3NlZCwgZXhjZXB0IG9uIG1hY09TLiBUaGVyZSwgaXQncyBjb21tb25cbi8vIGZvciBhcHBsaWNhdGlvbnMgYW5kIHRoZWlyIG1lbnUgYmFyIHRvIHN0YXkgYWN0aXZlIHVudGlsIHRoZSB1c2VyIHF1aXRzXG4vLyBleHBsaWNpdGx5IHdpdGggQ21kICsgUS5cbmFwcC5vbignd2luZG93LWFsbC1jbG9zZWQnLCAoKSA9PiB7XG4gIGlmIChwcm9jZXNzLnBsYXRmb3JtICE9PSAnZGFyd2luJykge1xuICAgIGFwcC5xdWl0KClcbiAgICB3aW4gPSBudWxsXG4gIH1cbn0pXG5cbmFwcC5vbignYWN0aXZhdGUnLCAoKSA9PiB7XG4gIC8vIE9uIE9TIFggaXQncyBjb21tb24gdG8gcmUtY3JlYXRlIGEgd2luZG93IGluIHRoZSBhcHAgd2hlbiB0aGVcbiAgLy8gZG9jayBpY29uIGlzIGNsaWNrZWQgYW5kIHRoZXJlIGFyZSBubyBvdGhlciB3aW5kb3dzIG9wZW4uXG4gIGlmIChCcm93c2VyV2luZG93LmdldEFsbFdpbmRvd3MoKS5sZW5ndGggPT09IDApIHtcbiAgICBjcmVhdGVXaW5kb3coKVxuICB9XG59KVxuXG5hcHAud2hlblJlYWR5KCkudGhlbihjcmVhdGVXaW5kb3cpXG5cbi8vIElQQyBoYW5kbGVycyBmb3IgZmlsZSBvcGVyYXRpb25zXG5pcGNNYWluLmhhbmRsZSgncmVhZC1maWxlJywgYXN5bmMgKF8sIGZpbGVQYXRoOiBzdHJpbmcpID0+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgZnMucmVhZEZpbGUoZmlsZVBhdGgsICd1dGYtOCcpXG4gICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgY29udGVudCB9XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiAoZXJyb3IgYXMgRXJyb3IpLm1lc3NhZ2UgfVxuICB9XG59KVxuXG5pcGNNYWluLmhhbmRsZSgnd3JpdGUtZmlsZScsIGFzeW5jIChfLCBmaWxlUGF0aDogc3RyaW5nLCBjb250ZW50OiBzdHJpbmcpID0+IHtcbiAgdHJ5IHtcbiAgICBhd2FpdCBmcy53cml0ZUZpbGUoZmlsZVBhdGgsIGNvbnRlbnQsICd1dGYtOCcpXG4gICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiAoZXJyb3IgYXMgRXJyb3IpLm1lc3NhZ2UgfVxuICB9XG59KVxuXG5pcGNNYWluLmhhbmRsZSgnc2hvdy1vcGVuLWRpYWxvZycsIGFzeW5jICgpID0+IHtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGlhbG9nLnNob3dPcGVuRGlhbG9nKHdpbiEsIHtcbiAgICBwcm9wZXJ0aWVzOiBbJ29wZW5GaWxlJ11cbiAgfSlcbiAgcmV0dXJuIHJlc3VsdFxufSlcblxuaXBjTWFpbi5oYW5kbGUoJ3Nob3ctc2F2ZS1kaWFsb2cnLCBhc3luYyAoKSA9PiB7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRpYWxvZy5zaG93U2F2ZURpYWxvZyh3aW4hLCB7XG4gICAgZmlsdGVyczogW1xuICAgICAgeyBuYW1lOiAnQXNlbWljIEZpbGVzJywgZXh0ZW5zaW9uczogWydhc2VtaWMnXSB9LFxuICAgICAgeyBuYW1lOiAnQWxsIEZpbGVzJywgZXh0ZW5zaW9uczogWycqJ10gfVxuICAgIF1cbiAgfSlcbiAgcmV0dXJuIHJlc3VsdFxufSlcbiJdLCJuYW1lcyI6WyJ1dGlsIiwib2JqZWN0VXRpbCIsImRlZmF1bHRFcnJvck1hcCIsInBhdGgiLCJlcnJvclV0aWwiLCJlcnJvck1hcCIsImN0eCIsInJlc3VsdCIsImlzc3VlcyIsImVsZW1lbnRzIiwicHJvY2Vzc2VkIiwiWm9kRmlyc3RQYXJ0eVR5cGVLaW5kIiwiei5vYmplY3QiLCJ6LmxpdGVyYWwiLCJ6Lm51bWJlciIsInoucmVjb3JkIiwiei5zdHJpbmciLCJTb2NrZXRJT1NlcnZlciIsIlNlcnZlciJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7OztBQUFPLElBQUk7QUFBQSxDQUNWLFNBQVVBLE9BQU07QUFDYixFQUFBQSxNQUFLLGNBQWMsQ0FBQyxNQUFNO0FBQUEsRUFBQTtBQUMxQixXQUFTLFNBQVMsTUFBTTtBQUFBLEVBQUE7QUFDeEIsRUFBQUEsTUFBSyxXQUFXO0FBQ2hCLFdBQVMsWUFBWSxJQUFJO0FBQ3JCLFVBQU0sSUFBSSxNQUFLO0FBQUEsRUFDdkI7QUFDSSxFQUFBQSxNQUFLLGNBQWM7QUFDbkIsRUFBQUEsTUFBSyxjQUFjLENBQUMsVUFBVTtBQUMxQixVQUFNLE1BQU0sQ0FBQTtBQUNaLGVBQVcsUUFBUSxPQUFPO0FBQ3RCLFVBQUksSUFBSSxJQUFJO0FBQUEsSUFDeEI7QUFDUSxXQUFPO0FBQUEsRUFDZjtBQUNJLEVBQUFB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QU8sQ0FBQyxDQUFDLEtBQUssS0FBSyxPQUFPLEtBQUssQ0FBQyxPQUFPLEdBQUcsU0FBUyxLQUFLO0FBQUEsRUFDaEU7QUFBQSxFQUNJLElBQUksVUFBVTtBQUNWLFdBQU8sQ0FBQyxDQUFDLEtBQUssS0FBSyxPQUFPLEtBQUssQ0FBQyxPQUFPLEdBQUcsU0FBUyxPQUFPO0FBQUEsRUFDbEU7QUFBQSxFQUNJLElBQUksU0FBUztBQUNULFdBQU8sQ0FBQyxDQUFDLEtBQUssS0FBSyxPQUFPLEtBQUssQ0FBQyxPQUFPLEdBQUcsU0FBUyxNQUFNO0FBQUEsRUFDakU7QUFBQSxFQUNJLElBQUksV0FBVztBQUNYLFdBQU8sQ0FBQyxDQUFDLEtBQUssS0FBSyxPQUFPLEtBQUssQ0FBQyxPQUFPLEdBQUcsU0FBUyxRQUFRO0FBQUEsRUFDbkU7QUFBQSxFQUNJLElBQUksU0FBUztBQUNULFdBQU8sQ0FBQyxDQUFDLEtBQUssS0FBSyxPQUFPLEtBQUssQ0FBQyxPQUFPLEdBQUcsU0FBUyxNQUFNO0FBQUEsRUFDakU7QUFBQSxFQUNJLElBQUksVUFBVTtBQUNWLFdBQU8sQ0FBQyxDQUFDLEtBQUssS0FBSyxPQUFPLEtBQUssQ0FBQyxPQUFPLEdBQUcsU0FBUyxPQUFPO0FBQUEsRUFDbEU7QUFBQSxFQUNJLElBQUksU0FBUztBQUNULFdBQU8sQ0FBQyxDQUFDLEtBQUssS0FBSyxPQUFPLEtBQUssQ0FBQyxPQUFPLEdBQUcsU0FBUyxNQUFNO0FBQUEsRUFDakU7QUFBQSxFQUNJLElBQUksT0FBTztBQUNQLFdBQU8sQ0FBQyxDQUFDLEtBQUssS0FBSyxPQUFPLEtBQUssQ0FBQyxPQUFPLEdBQUcsU0FBUyxJQUFJO0FBQUEsRUFDL0Q7QUFBQSxFQUNJLElBQUksU0FBUztBQUNULFdBQU8sQ0FBQyxDQUFDLEtBQUssS0FBSyxPQUFPLEtBQUssQ0FBQyxPQUFPLEdBQUcsU0FBUyxNQUFNO0FBQUEsRUFDakU7QUFBQSxFQUNJLElBQUksV0FBVztBQUNYLFdBQU8sQ0FBQyxDQUFDLEtBQUssS0FBSyxPQUFPLEtBQUssQ0FB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RUwsUUFBSSxTQUFTLEtBQUssS0FBSyxlQUFlLFlBQVksQ0FBQztBQUFBLEVBQUE7QUFHckQsaUJBQUE7QUFDRjtBQUtBLElBQUksR0FBRyxxQkFBcUIsTUFBTTtBQUNoQyxNQUFJLFFBQVEsYUFBYSxVQUFVO0FBQ2pDLFFBQUksS0FBQTtBQUNKLFVBQU07QUFBQSxFQUFBO0FBRVYsQ0FBQztBQUVELElBQUksR0FBRyxZQUFZLE1BQU07QUFHdkIsTUFBSSxjQUFjLGdCQUFnQixXQUFXLEdBQUc7QUFDOUMsaUJBQUE7QUFBQSxFQUFhO0FBRWpCLENBQUM7QUFFRCxJQUFJLFVBQUEsRUFBWSxLQUFLLFlBQVk7QUFHakMsUUFBUSxPQUFPLGFBQWEsT0FBTyxHQUFHLGFBQXFCO0FBQ3pELE1BQUk7QUFDRixVQUFNLFVBQVUsTUFBTSxHQUFHLFNBQVMsVUFBVSxPQUFPO0FBQ25ELFdBQU8sRUFBRSxTQUFTLE1BQU0sUUFBQTtBQUFBLEVBQVEsU0FDekIsT0FBTztBQUNkLFdBQU8sRUFBRSxTQUFTLE9BQU8sT0FBUSxNQUFnQixRQUFBO0FBQUEsRUFBUTtBQUU3RCxDQUFDO0FBRUQsUUFBUSxPQUFPLGNBQWMsT0FBTyxHQUFHLFVBQWtCLFlBQW9CO0FBQzNFLE1BQUk7QUFDRixVQUFNLEdBQUcsVUFBVSxVQUFVLFNBQVMsT0FBTztBQUM3QyxXQUFPLEVBQUUsU0FBUyxLQUFBO0FBQUEsRUFBSyxTQUNoQixPQUFPO0FBQ2QsV0FBTyxFQUFFLFNBQVMsT0FBTyxPQUFRLE1BQWdCLFFBQUE7QUFBQSxFQUFRO0FBRTdELENBQUM7QUFFRCxRQUFRLE9BQU8sb0JBQW9CLFlBQVk7QUFDN0MsUUFBTSxTQUFTLE1BQU0sT0FBTyxlQUFlLEtBQU07QUFBQSxJQUMvQyxZQUFZLENBQUMsVUFBVTtBQUFBLEVBQUEsQ0FDeEI7QUFDRCxTQUFPO0FBQ1QsQ0FBQztBQUVELFFBQVEsT0FBTyxvQkFBb0IsWUFBWTtBQUM3QyxRQUFNLFNBQVMsTUFBTSxPQUFPLGVBQWUsS0FBTTtBQUFBLElBQy9DLFNBQVM7QUFBQSxNQUNQLEVBQUUsTUFBTSxnQkFBZ0IsWUFBWSxDQUFDLFFBQVEsRUFBQTtBQUFBLE1BQzdDLEVBQUUsTUFBTSxhQUFhLFlBQVksQ0FBQyxHQUFHLEVBQUE7QUFBQSxJQUFFO0FBQUEsRUFDekMsQ0FDRDtBQUNELFNBQU87QUFDVCxDQUFDOyIsInhfZ29vZ2xlX2lnbm9yZUxpc3QiOlswLDEsMiwzLDQsNSw2XX0=
