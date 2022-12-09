'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.ValuesOfCorrectTypeRule = void 0;
const didYouMean_js_1 = require('../../jsutils/didYouMean.js');
const inspect_js_1 = require('../../jsutils/inspect.js');
const keyMap_js_1 = require('../../jsutils/keyMap.js');
const suggestionList_js_1 = require('../../jsutils/suggestionList.js');
const GraphQLError_js_1 = require('../../error/GraphQLError.js');
const printer_js_1 = require('../../language/printer.js');
const definition_js_1 = require('../../type/definition.js');
/**
 * Value literals of correct type
 *
 * A GraphQL document is only valid if all value literals are of the type
 * expected at their position.
 *
 * See https://spec.graphql.org/draft/#sec-Values-of-Correct-Type
 */
function ValuesOfCorrectTypeRule(context) {
  return {
    ListValue(node) {
      // Note: TypeInfo will traverse into a list's item type, so look to the
      // parent input type to check if it is a list.
      const type = (0, definition_js_1.getNullableType)(
        context.getParentInputType(),
      );
      if (!(0, definition_js_1.isListType)(type)) {
        isValidValueNode(context, node);
        return false; // Don't traverse further.
      }
    },
    ObjectValue(node) {
      const type = (0, definition_js_1.getNamedType)(context.getInputType());
      if (!(0, definition_js_1.isInputObjectType)(type)) {
        isValidValueNode(context, node);
        return false; // Don't traverse further.
      }
      // Ensure every required field exists.
      const fieldNodeMap = (0, keyMap_js_1.keyMap)(
        node.fields,
        (field) => field.name.value,
      );
      for (const fieldDef of Object.values(type.getFields())) {
        const fieldNode = fieldNodeMap[fieldDef.name];
        if (!fieldNode && (0, definition_js_1.isRequiredInputField)(fieldDef)) {
          const typeStr = (0, inspect_js_1.inspect)(fieldDef.type);
          context.reportError(
            new GraphQLError_js_1.GraphQLError(
              `Field "${type.name}.${fieldDef.name}" of required type "${typeStr}" was not provided.`,
              { nodes: node },
            ),
          );
        }
      }
    },
    ObjectField(node) {
      const parentType = (0, definition_js_1.getNamedType)(
        context.getParentInputType(),
      );
      const fieldType = context.getInputType();
      if (!fieldType && (0, definition_js_1.isInputObjectType)(parentType)) {
        const suggestions = (0, suggestionList_js_1.suggestionList)(
          node.name.value,
          Object.keys(parentType.getFields()),
        );
        context.reportError(
          new GraphQLError_js_1.GraphQLError(
            `Field "${node.name.value}" is not defined by type "${parentType.name}".` +
              (0, didYouMean_js_1.didYouMean)(suggestions),
            { nodes: node },
          ),
        );
      }
    },
    NullValue(node) {
      const type = context.getInputType();
      if ((0, definition_js_1.isNonNullType)(type)) {
        context.reportError(
          new GraphQLError_js_1.GraphQLError(
            `Expected value of type "${(0, inspect_js_1.inspect)(
              type,
            )}", found ${(0, printer_js_1.print)(node)}.`,
            { nodes: node },
          ),
        );
      }
    },
    EnumValue: (node) => isValidValueNode(context, node),
    IntValue: (node) => isValidValueNode(context, node),
    FloatValue: (node) => isValidValueNode(context, node),
    StringValue: (node) => isValidValueNode(context, node),
    BooleanValue: (node) => isValidValueNode(context, node),
  };
}
exports.ValuesOfCorrectTypeRule = ValuesOfCorrectTypeRule;
/**
 * Any value literal may be a valid representation of a Scalar, depending on
 * that scalar type.
 */
function isValidValueNode(context, node) {
  // Report any error at the full type expected by the location.
  const locationType = context.getInputType();
  if (!locationType) {
    return;
  }
  const type = (0, definition_js_1.getNamedType)(locationType);
  if (!(0, definition_js_1.isLeafType)(type)) {
    const typeStr = (0, inspect_js_1.inspect)(locationType);
    context.reportError(
      new GraphQLError_js_1.GraphQLError(
        `Expected value of type "${typeStr}", found ${(0, printer_js_1.print)(
          node,
        )}.`,
        { nodes: node },
      ),
    );
    return;
  }
  // Scalars and Enums determine if a literal value is valid via parseLiteral(),
  // which may throw or return an invalid value to indicate failure.
  try {
    const parseResult = type.parseLiteral(node, undefined /* variables */);
    if (parseResult === undefined) {
      const typeStr = (0, inspect_js_1.inspect)(locationType);
      context.reportError(
        new GraphQLError_js_1.GraphQLError(
          `Expected value of type "${typeStr}", found ${(0, printer_js_1.print)(
            node,
          )}.`,
          { nodes: node },
        ),
      );
    }
  } catch (error) {
    const typeStr = (0, inspect_js_1.inspect)(locationType);
    if (error instanceof GraphQLError_js_1.GraphQLError) {
      context.reportError(error);
    } else {
      context.reportError(
        new GraphQLError_js_1.GraphQLError(
          `Expected value of type "${typeStr}", found ${(0, printer_js_1.print)(
            node,
          )}; ` + error.message,
          { nodes: node, originalError: error },
        ),
      );
    }
  }
}
