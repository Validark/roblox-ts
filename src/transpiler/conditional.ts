import * as ts from "ts-morph";
import { transpileExpression } from ".";
import { TranspilerState } from "../TranspilerState";

function strWithoutParens(str: string) {
	// Not very sophisticated, but because we are only matching things of the form ((_N))
	// and _N is blocked as an identifier in Roblox-TS
	// This will always work for this case

	while (str[0] === "(" && str[str.length - 1] === ")") {
		str = str.slice(1, -1);
		console.log(str);
	}
	return str;
}

export function transpileConditionalExpression(state: TranspilerState, node: ts.ConditionalExpression) {
	let id: string;
	let result = "";
	const currentConditionalContext = state.currentConditionalContext;

	if (currentConditionalContext) {
		id = currentConditionalContext;
	} else {
		id = state.getNewId();
		state.currentConditionalContext = id;
		result = state.indent + `local ${id};\n`;
	}
	result += state.indent + `if ${transpileExpression(state, node.getCondition())} then\n`;
	state.pushIndent();
	state.enterPreStatementContext();
	const whenTrueStr = transpileExpression(state, node.getWhenTrue());
	result += state.exitPreStatementContext();
	if (id !== strWithoutParens(whenTrueStr)) {
		result += state.indent + `${id} = ${whenTrueStr};\n`;
	}
	state.popIndent();
	result += state.indent + `else\n`;
	state.pushIndent();
	state.enterPreStatementContext();
	const whenFalseStr = transpileExpression(state, node.getWhenFalse());
	result += state.exitPreStatementContext();
	if (id !== strWithoutParens(whenFalseStr)) {
		result += state.indent + `${id} = ${whenFalseStr};\n`;
	}
	state.popIndent();
	result += state.indent + `end;\n`;
	state.pushPreStatement(result);
	return id;
}
