import * as ts from "ts-morph";
import { transpileExpression } from ".";
import { TranspilerState } from "../TranspilerState";

function strWithoutParens(str: string) {
	// Not very sophisticated, but because we are only matching things of the form ((_N))
	// and _N is blocked as an identifier in Roblox-TS
	// This will always work for this case

	while (str[0] === "(" && str[str.length - 1] === ")") {
		str = str.slice(1, -1);
	}
	return str;
}

export function transpileConditionalExpression(state: TranspilerState, node: ts.ConditionalExpression) {
	let id: string;
	const currentConditionalContext = state.currentConditionalContext;

	if (currentConditionalContext === "") {
		id = state.getNewId();
		state.currentConditionalContext = id;
		state.pushPreStatement(state.indent + `local ${id};\n`);
	} else {
		id = currentConditionalContext;
	}
	state.pushPreStatement(state.indent + `if ${transpileExpression(state, node.getCondition())} then\n`);
	state.pushIndent();
	const whenTrueStr = transpileExpression(state, node.getWhenTrue());

	if (id !== strWithoutParens(whenTrueStr)) {
		state.pushPreStatement(state.indent + `${id} = ${whenTrueStr};\n`);
	}
	state.popIndent();
	state.pushPreStatement(state.indent + `else\n`);
	state.pushIndent();
	const whenFalseStr = transpileExpression(state, node.getWhenFalse());
	if (id !== strWithoutParens(whenFalseStr)) {
		state.pushPreStatement(state.indent + `${id} = ${whenFalseStr};\n`);
	}
	state.popIndent();
	state.pushPreStatement(state.indent + `end;\n`);

	if (currentConditionalContext === "") {
		state.currentConditionalContext = "";
	}
	return id;
}
