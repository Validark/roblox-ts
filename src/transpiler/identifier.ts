import * as ts from "ts-morph";
import { checkReserved } from ".";
import { TranspilerState } from "../TranspilerState";
import { getModifiedVariablesInExpression } from "./expression";

export const BUILT_INS = ["Promise", "Symbol", "typeIs"];

export const replacements: ReadonlyMap<string, string> = new Map<string, string>([
	["undefined", "nil"],
	["typeOf", "typeof"],
]);

export function transpileRawIdentifier(state: TranspilerState, node: ts.Identifier, isDefinition: boolean = false) {
	let name = node.getText();
	const replacement = replacements.get(name);

	if (replacement) {
		return replacement;
	}

	checkReserved(name, node);
	if (BUILT_INS.indexOf(name) !== -1) {
		state.usesTSLibrary = true;
		name = `TS.${name}`;
	}

	const definitions = isDefinition ? [node] : node.getDefinitions().map(def => def.getNode());

	for (const definition of definitions) {
		// I have no idea why, but getDefinitionNodes() cannot replace this
		if (definition.getSourceFile() === node.getSourceFile()) {
			let parent = definition;

			do {
				if (ts.TypeGuards.isVariableStatement(parent)) {
					if (parent.hasExportKeyword()) {
						const declarationKind = parent.getDeclarationKind();
						if (declarationKind === ts.VariableDeclarationKind.Let) {
							return state.getExportContextName(parent) + "." + name;
						} else if (declarationKind === ts.VariableDeclarationKind.Const) {
							const idContext = node.getFirstAncestorByKind(ts.SyntaxKind.ModuleDeclaration);
							const defContext = parent.getFirstAncestorByKind(ts.SyntaxKind.ModuleDeclaration);

							if (idContext && defContext && idContext !== defContext) {
								state.pushHoistStack(`local ${name} = ${state.getNameForContext(defContext)}.${name}`);
							}
						}
					}
					break;
				} else if (ts.TypeGuards.isNamespaceDeclaration(parent)) {
					// If within a namespace, scope it. If it is a namespace, don't
					if (parent !== definition.getParent()) {
						const parentName = state.namespaceStack.get(parent.getName());
						if (parentName) {
							return parentName + "." + name;
						}
					} else {
						const idContext = node.getFirstAncestorByKind(ts.SyntaxKind.ModuleDeclaration);
						const defContext = parent.getFirstAncestorByKind(ts.SyntaxKind.ModuleDeclaration);

						if (idContext && defContext && idContext !== defContext) {
							state.pushHoistStack(`local ${name} = ${state.getNameForContext(defContext)}.${name}`);
						}
					}
					break;
				} else if (parent.getKind() === ts.SyntaxKind.OpenParenToken) {
					parent = parent.getParent();
					if (!ts.TypeGuards.isArrowFunction(parent)) {
						break;
					}
				} else if (
					!ts.TypeGuards.isVariableDeclarationList(parent) &&
					!ts.TypeGuards.isIdentifier(parent) &&
					!ts.TypeGuards.isBindingElement(parent) &&
					!ts.TypeGuards.isArrayBindingPattern(parent) &&
					!ts.TypeGuards.isVariableDeclaration(parent) &&
					!ts.TypeGuards.isObjectBindingPattern(parent)
				) {
					break;
				}
				parent = parent.getParent();
			} while (parent);
		}
	}

	return state.getAlias(name);
}

export function transpileIdentifier(state: TranspilerState, node: ts.Identifier, isDefinition: boolean = false) {
	const transpiledSource = transpileRawIdentifier(state, node, isDefinition);

	// let references: Array<ts.Node>;

	// try {
	// 	references = node.findReferencesAsNodes();
	// } catch {
	// 	references = [];
	// }

	// const referenceSet = new Set(references);
	// referenceSet.delete(node);

	// let layer = 0;
	// /**
	//  * Climb the ancestoral tree until we reach a statement, and find nextSiblings which modify this variable.
	//  * If they exist, push the current value to a preStatement so it cannot be contaminated.
	//  * The only exceptions to this rule are Statements/Expressions which have separate scopes,
	//  * like ConditionalExpressions/ForStatements.
	//  */
	// for (const ancestor of [node, ...node.getAncestors()]) {
	// 	const parent = ancestor.getParent();
	// 	console.log("\t".repeat(layer) + "ancestor:", ancestor.getKindName(), ancestor.getText());
	// 	if (parent) {
	// 		console.log("\t".repeat(layer) + "parent:", parent.getKindName(), parent.getText());
	// 	}
	// 	if (ts.TypeGuards.isStatement(ancestor)) {
	// 		console.log("\t".repeat(layer) + "isStatement");
	// 	} else if (ts.TypeGuards.isDeclarationNamedNode(ancestor)) {
	// 		console.log("\t".repeat(layer) + "isDeclarationNamedNode");
	// 	} else if (parent) {
	// 		if (ts.TypeGuards.isForStatement(parent)) {
	// 			console.log("\t".repeat(layer) + "isForStatement");
	// 		} else if (ts.TypeGuards.isConditionalExpression(parent)) {
	// 			console.log("\t".repeat(layer) + "isConditionalExpression");
	// 		} else if (ts.TypeGuards.isIfStatement(parent)) {
	// 			console.log("\t".repeat(layer) + "isIfStatement");
	// 		}
	// 	}

	// 	if ((parent && ts.TypeGuards.isStatement(parent)) || ts.TypeGuards.isDeclarationNamedNode(ancestor)) {
	// 		break;
	// 	}

	// 	for (const sibling of ancestor.getNextSiblings()) {
	// 		console.log("\t".repeat(layer + 1) + "sibling:", sibling.getKindName(), sibling.getText());
	// 		for (const modifiedVar of getModifiedVariablesInExpression(sibling)) {
	// 			console.log("\t".repeat(layer + 2) + "modifiedVar:", modifiedVar.getKindName(), modifiedVar.getText());
	// 			if (referenceSet.has(modifiedVar)) {
	// 				console.log("\t".repeat(layer + 3) + ">", transpiledSource);
	// 				return state.pushPreStatementToNextId(transpiledSource);
	// 			}
	// 		}
	// 	}
	// 	layer++;
	// }

	return transpiledSource;
}
