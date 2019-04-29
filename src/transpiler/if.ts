import * as ts from "ts-morph";
import { transpileExpression, transpileStatement } from ".";
import { TranspilerState } from "../TranspilerState";

export function transpileIfStatement(state: TranspilerState, node: ts.IfStatement) {
	let result = "";
	const expStr = transpileExpression(state, node.getExpression());
	result += state.indent + `if ${expStr} then\n`;
	state.pushIndent();
	result += transpileStatement(state, node.getThenStatement());
	state.popIndent();
	let elseStatement = node.getElseStatement();
	let numBlocks = 1;

	while (elseStatement && ts.TypeGuards.isIfStatement(elseStatement)) {
		state.enterPreStatementContext();
		state.pushIndent();
		const elseIfExpression = transpileExpression(state, elseStatement.getExpression());

		if (state.hasPreStatementsInContext()) {
			state.popIndent();
			result += state.indent + `else\n`;
			state.pushIndent();
			numBlocks++;
			result += state.exitPreStatementContext();
			result += state.indent + `if ${elseIfExpression} then\n`;
		} else {
			state.popIndent();
			state.exitPreStatementContext();
			result += state.indent + `elseif ${elseIfExpression} then\n`;
		}

		state.pushIndent();
		result += transpileStatement(state, elseStatement.getThenStatement());
		state.popIndent();
		elseStatement = elseStatement.getElseStatement();
	}

	if (elseStatement) {
		result += state.indent + "else\n";
		state.pushIndent();
		result += transpileStatement(state, elseStatement);
		state.popIndent();
	}

	result += state.indent + `end;\n`;

	for (let i = 1; i < numBlocks; i++) {
		state.popIndent();
		result += state.indent + `end;\n`;
	}
	return result;
}
