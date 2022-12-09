'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.assertValidSchema = exports.validateSchema = void 0;
const AccumulatorMap_js_1 = require('../jsutils/AccumulatorMap.js');
const capitalize_js_1 = require('../jsutils/capitalize.js');
const formatList_js_1 = require('../jsutils/formatList.js');
const inspect_js_1 = require('../jsutils/inspect.js');
const GraphQLError_js_1 = require('../error/GraphQLError.js');
const ast_js_1 = require('../language/ast.js');
const typeComparators_js_1 = require('../utilities/typeComparators.js');
const definition_js_1 = require('./definition.js');
const directives_js_1 = require('./directives.js');
const introspection_js_1 = require('./introspection.js');
const schema_js_1 = require('./schema.js');
/**
 * Implements the "Type Validation" sub-sections of the specification's
 * "Type System" section.
 *
 * Validation runs synchronously, returning an array of encountered errors, or
 * an empty array if no errors were encountered and the Schema is valid.
 */
function validateSchema(schema) {
  // First check to ensure the provided value is in fact a GraphQLSchema.
  (0, schema_js_1.assertSchema)(schema);
  // If this Schema has already been validated, return the previous results.
  if (schema.__validationErrors) {
    return schema.__validationErrors;
  }
  // Validate the schema, producing a list of errors.
  const context = new SchemaValidationContext(schema);
  validateRootTypes(context);
  validateDirectives(context);
  validateTypes(context);
  // Persist the results of validation before returning to ensure validation
  // does not run multiple times for this schema.
  const errors = context.getErrors();
  schema.__validationErrors = errors;
  return errors;
}
exports.validateSchema = validateSchema;
/**
 * Utility function which asserts a schema is valid by throwing an error if
 * it is invalid.
 */
function assertValidSchema(schema) {
  const errors = validateSchema(schema);
  if (errors.length !== 0) {
    throw new Error(errors.map((error) => error.message).join('\n\n'));
  }
}
exports.assertValidSchema = assertValidSchema;
class SchemaValidationContext {
  constructor(schema) {
    this._errors = [];
    this.schema = schema;
  }
  reportError(message, nodes) {
    const _nodes = Array.isArray(nodes) ? nodes.filter(Boolean) : nodes;
    this._errors.push(
      new GraphQLError_js_1.GraphQLError(message, { nodes: _nodes }),
    );
  }
  getErrors() {
    return this._errors;
  }
}
function validateRootTypes(context) {
  const schema = context.schema;
  if (schema.getQueryType() == null) {
    context.reportError('Query root type must be provided.', schema.astNode);
  }
  const rootTypesMap = new AccumulatorMap_js_1.AccumulatorMap();
  for (const operationType of Object.values(ast_js_1.OperationTypeNode)) {
    const rootType = schema.getRootType(operationType);
    if (rootType != null) {
      if (!(0, definition_js_1.isObjectType)(rootType)) {
        const operationTypeStr = (0, capitalize_js_1.capitalize)(operationType);
        const rootTypeStr = (0, inspect_js_1.inspect)(rootType);
        context.reportError(
          operationType === ast_js_1.OperationTypeNode.QUERY
            ? `${operationTypeStr} root type must be Object type, it cannot be ${rootTypeStr}.`
            : `${operationTypeStr} root type must be Object type if provided, it cannot be ${rootTypeStr}.`,
          getOperationTypeNode(schema, operationType) ?? rootType.astNode,
        );
      } else {
        rootTypesMap.add(rootType, operationType);
      }
    }
  }
  for (const [rootType, operationTypes] of rootTypesMap) {
    if (operationTypes.length > 1) {
      const operationList = (0, formatList_js_1.andList)(operationTypes);
      context.reportError(
        `All root types must be different, "${rootType.name}" type is used as ${operationList} root types.`,
        operationTypes.map((operationType) =>
          getOperationTypeNode(schema, operationType),
        ),
      );
    }
  }
}
function getOperationTypeNode(schema, operation) {
  return [schema.astNode, ...schema.extensionASTNodes]
    .flatMap(
      // FIXME: https://github.com/graphql/graphql-js/issues/2203
      (schemaNode) => /* c8 ignore next */ schemaNode?.operationTypes ?? [],
    )
    .find((operationNode) => operationNode.operation === operation)?.type;
}
function validateDirectives(context) {
  for (const directive of context.schema.getDirectives()) {
    // Ensure all directives are in fact GraphQL directives.
    if (!(0, directives_js_1.isDirective)(directive)) {
      context.reportError(
        `Expected directive but got: ${(0, inspect_js_1.inspect)(directive)}.`,
        directive?.astNode,
      );
      continue;
    }
    // Ensure they are named correctly.
    validateName(context, directive);
    // TODO: Ensure proper locations.
    // Ensure the arguments are valid.
    for (const arg of directive.args) {
      // Ensure they are named correctly.
      validateName(context, arg);
      // Ensure the type is an input type.
      if (!(0, definition_js_1.isInputType)(arg.type)) {
        context.reportError(
          `The type of @${directive.name}(${arg.name}:) must be Input Type ` +
            `but got: ${(0, inspect_js_1.inspect)(arg.type)}.`,
          arg.astNode,
        );
      }
      if (
        (0, definition_js_1.isRequiredArgument)(arg) &&
        arg.deprecationReason != null
      ) {
        context.reportError(
          `Required argument @${directive.name}(${arg.name}:) cannot be deprecated.`,
          [getDeprecatedDirectiveNode(arg.astNode), arg.astNode?.type],
        );
      }
    }
  }
}
function validateName(context, node) {
  // Ensure names are valid, however introspection types opt out.
  if (node.name.startsWith('__')) {
    context.reportError(
      `Name "${node.name}" must not begin with "__", which is reserved by GraphQL introspection.`,
      node.astNode,
    );
  }
}
function validateTypes(context) {
  const validateInputObjectCircularRefs =
    createInputObjectCircularRefsValidator(context);
  const typeMap = context.schema.getTypeMap();
  for (const type of Object.values(typeMap)) {
    // Ensure all provided types are in fact GraphQL type.
    if (!(0, definition_js_1.isNamedType)(type)) {
      context.reportError(
        `Expected GraphQL named type but got: ${(0, inspect_js_1.inspect)(
          type,
        )}.`,
        type.astNode,
      );
      continue;
    }
    // Ensure it is named correctly (excluding introspection types).
    if (!(0, introspection_js_1.isIntrospectionType)(type)) {
      validateName(context, type);
    }
    if ((0, definition_js_1.isObjectType)(type)) {
      // Ensure fields are valid
      validateFields(context, type);
      // Ensure objects implement the interfaces they claim to.
      validateInterfaces(context, type);
    } else if ((0, definition_js_1.isInterfaceType)(type)) {
      // Ensure fields are valid.
      validateFields(context, type);
      // Ensure interfaces implement the interfaces they claim to.
      validateInterfaces(context, type);
    } else if ((0, definition_js_1.isUnionType)(type)) {
      // Ensure Unions include valid member types.
      validateUnionMembers(context, type);
    } else if ((0, definition_js_1.isEnumType)(type)) {
      // Ensure Enums have valid values.
      validateEnumValues(context, type);
    } else if ((0, definition_js_1.isInputObjectType)(type)) {
      // Ensure Input Object fields are valid.
      validateInputFields(context, type);
      // Ensure Input Objects do not contain non-nullable circular references
      validateInputObjectCircularRefs(type);
    }
  }
}
function validateFields(context, type) {
  const fields = Object.values(type.getFields());
  // Objects and Interfaces both must define one or more fields.
  if (fields.length === 0) {
    context.reportError(`Type ${type.name} must define one or more fields.`, [
      type.astNode,
      ...type.extensionASTNodes,
    ]);
  }
  for (const field of fields) {
    // Ensure they are named correctly.
    validateName(context, field);
    // Ensure the type is an output type
    if (!(0, definition_js_1.isOutputType)(field.type)) {
      context.reportError(
        `The type of ${type.name}.${field.name} must be Output Type ` +
          `but got: ${(0, inspect_js_1.inspect)(field.type)}.`,
        field.astNode?.type,
      );
    }
    // Ensure the arguments are valid
    for (const arg of field.args) {
      const argName = arg.name;
      // Ensure they are named correctly.
      validateName(context, arg);
      // Ensure the type is an input type
      if (!(0, definition_js_1.isInputType)(arg.type)) {
        context.reportError(
          `The type of ${type.name}.${field.name}(${argName}:) must be Input ` +
            `Type but got: ${(0, inspect_js_1.inspect)(arg.type)}.`,
          arg.astNode?.type,
        );
      }
      if (
        (0, definition_js_1.isRequiredArgument)(arg) &&
        arg.deprecationReason != null
      ) {
        context.reportError(
          `Required argument ${type.name}.${field.name}(${argName}:) cannot be deprecated.`,
          [getDeprecatedDirectiveNode(arg.astNode), arg.astNode?.type],
        );
      }
    }
  }
}
function validateInterfaces(context, type) {
  const ifaceTypeNames = new Set();
  for (const iface of type.getInterfaces()) {
    if (!(0, definition_js_1.isInterfaceType)(iface)) {
      context.reportError(
        `Type ${(0, inspect_js_1.inspect)(
          type,
        )} must only implement Interface types, ` +
          `it cannot implement ${(0, inspect_js_1.inspect)(iface)}.`,
        getAllImplementsInterfaceNodes(type, iface),
      );
      continue;
    }
    if (type === iface) {
      context.reportError(
        `Type ${type.name} cannot implement itself because it would create a circular reference.`,
        getAllImplementsInterfaceNodes(type, iface),
      );
      continue;
    }
    if (ifaceTypeNames.has(iface.name)) {
      context.reportError(
        `Type ${type.name} can only implement ${iface.name} once.`,
        getAllImplementsInterfaceNodes(type, iface),
      );
      continue;
    }
    ifaceTypeNames.add(iface.name);
    validateTypeImplementsAncestors(context, type, iface);
    validateTypeImplementsInterface(context, type, iface);
  }
}
function validateTypeImplementsInterface(context, type, iface) {
  const typeFieldMap = type.getFields();
  // Assert each interface field is implemented.
  for (const ifaceField of Object.values(iface.getFields())) {
    const fieldName = ifaceField.name;
    const typeField = typeFieldMap[fieldName];
    // Assert interface field exists on type.
    if (!typeField) {
      context.reportError(
        `Interface field ${iface.name}.${fieldName} expected but ${type.name} does not provide it.`,
        [ifaceField.astNode, type.astNode, ...type.extensionASTNodes],
      );
      continue;
    }
    // Assert interface field type is satisfied by type field type, by being
    // a valid subtype. (covariant)
    if (
      !(0, typeComparators_js_1.isTypeSubTypeOf)(
        context.schema,
        typeField.type,
        ifaceField.type,
      )
    ) {
      context.reportError(
        `Interface field ${iface.name}.${fieldName} expects type ` +
          `${(0, inspect_js_1.inspect)(ifaceField.type)} but ${
            type.name
          }.${fieldName} ` +
          `is type ${(0, inspect_js_1.inspect)(typeField.type)}.`,
        [ifaceField.astNode?.type, typeField.astNode?.type],
      );
    }
    // Assert each interface field arg is implemented.
    for (const ifaceArg of ifaceField.args) {
      const argName = ifaceArg.name;
      const typeArg = typeField.args.find((arg) => arg.name === argName);
      // Assert interface field arg exists on object field.
      if (!typeArg) {
        context.reportError(
          `Interface field argument ${iface.name}.${fieldName}(${argName}:) expected but ${type.name}.${fieldName} does not provide it.`,
          [ifaceArg.astNode, typeField.astNode],
        );
        continue;
      }
      // Assert interface field arg type matches object field arg type.
      // (invariant)
      // TODO: change to contravariant?
      if (!(0, typeComparators_js_1.isEqualType)(ifaceArg.type, typeArg.type)) {
        context.reportError(
          `Interface field argument ${iface.name}.${fieldName}(${argName}:) ` +
            `expects type ${(0, inspect_js_1.inspect)(ifaceArg.type)} but ` +
            `${type.name}.${fieldName}(${argName}:) is type ` +
            `${(0, inspect_js_1.inspect)(typeArg.type)}.`,
          [ifaceArg.astNode?.type, typeArg.astNode?.type],
        );
      }
      // TODO: validate default values?
    }
    // Assert additional arguments must not be required.
    for (const typeArg of typeField.args) {
      const argName = typeArg.name;
      const ifaceArg = ifaceField.args.find((arg) => arg.name === argName);
      if (!ifaceArg && (0, definition_js_1.isRequiredArgument)(typeArg)) {
        context.reportError(
          `Object field ${type.name}.${fieldName} includes required argument ${argName} that is missing from the Interface field ${iface.name}.${fieldName}.`,
          [typeArg.astNode, ifaceField.astNode],
        );
      }
    }
  }
}
function validateTypeImplementsAncestors(context, type, iface) {
  const ifaceInterfaces = type.getInterfaces();
  for (const transitive of iface.getInterfaces()) {
    if (!ifaceInterfaces.includes(transitive)) {
      context.reportError(
        transitive === type
          ? `Type ${type.name} cannot implement ${iface.name} because it would create a circular reference.`
          : `Type ${type.name} must implement ${transitive.name} because it is implemented by ${iface.name}.`,
        [
          ...getAllImplementsInterfaceNodes(iface, transitive),
          ...getAllImplementsInterfaceNodes(type, iface),
        ],
      );
    }
  }
}
function validateUnionMembers(context, union) {
  const memberTypes = union.getTypes();
  if (memberTypes.length === 0) {
    context.reportError(
      `Union type ${union.name} must define one or more member types.`,
      [union.astNode, ...union.extensionASTNodes],
    );
  }
  const includedTypeNames = new Set();
  for (const memberType of memberTypes) {
    if (includedTypeNames.has(memberType.name)) {
      context.reportError(
        `Union type ${union.name} can only include type ${memberType.name} once.`,
        getUnionMemberTypeNodes(union, memberType.name),
      );
      continue;
    }
    includedTypeNames.add(memberType.name);
    if (!(0, definition_js_1.isObjectType)(memberType)) {
      context.reportError(
        `Union type ${union.name} can only include Object types, ` +
          `it cannot include ${(0, inspect_js_1.inspect)(memberType)}.`,
        getUnionMemberTypeNodes(union, String(memberType)),
      );
    }
  }
}
function validateEnumValues(context, enumType) {
  const enumValues = enumType.getValues();
  if (enumValues.length === 0) {
    context.reportError(
      `Enum type ${enumType.name} must define one or more values.`,
      [enumType.astNode, ...enumType.extensionASTNodes],
    );
  }
  for (const enumValue of enumValues) {
    // Ensure valid name.
    validateName(context, enumValue);
  }
}
function validateInputFields(context, inputObj) {
  const fields = Object.values(inputObj.getFields());
  if (fields.length === 0) {
    context.reportError(
      `Input Object type ${inputObj.name} must define one or more fields.`,
      [inputObj.astNode, ...inputObj.extensionASTNodes],
    );
  }
  // Ensure the arguments are valid
  for (const field of fields) {
    // Ensure they are named correctly.
    validateName(context, field);
    // Ensure the type is an input type
    if (!(0, definition_js_1.isInputType)(field.type)) {
      context.reportError(
        `The type of ${inputObj.name}.${field.name} must be Input Type ` +
          `but got: ${(0, inspect_js_1.inspect)(field.type)}.`,
        field.astNode?.type,
      );
    }
    if (
      (0, definition_js_1.isRequiredInputField)(field) &&
      field.deprecationReason != null
    ) {
      context.reportError(
        `Required input field ${inputObj.name}.${field.name} cannot be deprecated.`,
        [getDeprecatedDirectiveNode(field.astNode), field.astNode?.type],
      );
    }
  }
}
function createInputObjectCircularRefsValidator(context) {
  // Modified copy of algorithm from 'src/validation/rules/NoFragmentCycles.js'.
  // Tracks already visited types to maintain O(N) and to ensure that cycles
  // are not redundantly reported.
  const visitedTypes = new Set();
  // Array of types nodes used to produce meaningful errors
  const fieldPath = [];
  // Position in the type path
  const fieldPathIndexByTypeName = Object.create(null);
  return detectCycleRecursive;
  // This does a straight-forward DFS to find cycles.
  // It does not terminate when a cycle was found but continues to explore
  // the graph to find all possible cycles.
  function detectCycleRecursive(inputObj) {
    if (visitedTypes.has(inputObj)) {
      return;
    }
    visitedTypes.add(inputObj);
    fieldPathIndexByTypeName[inputObj.name] = fieldPath.length;
    const fields = Object.values(inputObj.getFields());
    for (const field of fields) {
      if (
        (0, definition_js_1.isNonNullType)(field.type) &&
        (0, definition_js_1.isInputObjectType)(field.type.ofType)
      ) {
        const fieldType = field.type.ofType;
        const cycleIndex = fieldPathIndexByTypeName[fieldType.name];
        fieldPath.push(field);
        if (cycleIndex === undefined) {
          detectCycleRecursive(fieldType);
        } else {
          const cyclePath = fieldPath.slice(cycleIndex);
          const pathStr = cyclePath.map((fieldObj) => fieldObj.name).join('.');
          context.reportError(
            `Cannot reference Input Object "${fieldType.name}" within itself through a series of non-null fields: "${pathStr}".`,
            cyclePath.map((fieldObj) => fieldObj.astNode),
          );
        }
        fieldPath.pop();
      }
    }
    fieldPathIndexByTypeName[inputObj.name] = undefined;
  }
}
function getAllImplementsInterfaceNodes(type, iface) {
  const { astNode, extensionASTNodes } = type;
  const nodes =
    astNode != null ? [astNode, ...extensionASTNodes] : extensionASTNodes;
  // FIXME: https://github.com/graphql/graphql-js/issues/2203
  return nodes
    .flatMap((typeNode) => /* c8 ignore next */ typeNode.interfaces ?? [])
    .filter((ifaceNode) => ifaceNode.name.value === iface.name);
}
function getUnionMemberTypeNodes(union, typeName) {
  const { astNode, extensionASTNodes } = union;
  const nodes =
    astNode != null ? [astNode, ...extensionASTNodes] : extensionASTNodes;
  // FIXME: https://github.com/graphql/graphql-js/issues/2203
  return nodes
    .flatMap((unionNode) => /* c8 ignore next */ unionNode.types ?? [])
    .filter((typeNode) => typeNode.name.value === typeName);
}
function getDeprecatedDirectiveNode(definitionNode) {
  return definitionNode?.directives?.find(
    (node) =>
      node.name.value === directives_js_1.GraphQLDeprecatedDirective.name,
  );
}
