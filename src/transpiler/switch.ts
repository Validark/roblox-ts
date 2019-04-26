import * as ts from "ts-morph";
import { transpileExpression, transpileStatementedNode } from ".";
import { TranspilerError, TranspilerErrorType } from "../errors/TranspilerError";
import { TranspilerState } from "../TranspilerState";

export function transpileSwitchStatement(state: TranspilerState, node: ts.SwitchStatement) {
	const expStr = state.getNewId();
	let result = "";
	result += state.indent + `local ${expStr} = ${transpileExpression(state, node.getExpression())};\n`;
	result += state.indent + `repeat\n`;
	state.pushIndent();
	state.pushIdStack();
	const fallThroughVar = state.getNewId();

	const clauses = node.getCaseBlock().getClauses();
	let anyFallThrough = false;
	for (const clause of clauses) {
		const statements = clause.getStatements();

		let lastStatement = statements[statements.length - 1];
		while (lastStatement && ts.TypeGuards.isBlock(lastStatement)) {
			const blockStatements = lastStatement.getStatements();
			lastStatement = blockStatements[blockStatements.length - 1];
		}
		const endsInReturnOrBreakStatement =
			lastStatement &&
			(ts.TypeGuards.isReturnStatement(lastStatement) || ts.TypeGuards.isBreakStatement(lastStatement));
		if (!endsInReturnOrBreakStatement) {
			anyFallThrough = true;
		}
	}

	if (anyFallThrough) {
		result += state.indent + `local ${fallThroughVar} = false;\n`;
	}

	let lastFallThrough = false;
	const lastClauseIndex = clauses.length - 1;
	clauses.forEach((clause, i) => {
		// add if statement if the clause is non-default
		let isNonDefault = false;
		if (ts.TypeGuards.isCaseClause(clause)) {
			isNonDefault = true;
			const clauseExpStr = transpileExpression(state, clause.getExpression());
			const fallThroughVarOr = lastFallThrough ? `${fallThroughVar} or ` : "";
			result += state.indent + `if ${fallThroughVarOr}${expStr} == ( ${clauseExpStr} ) then\n`;
			state.pushIndent();
		} else if (i !== lastClauseIndex) {
			throw new TranspilerError(
				"Default case must be the last case in a switch statement!",
				clause,
				TranspilerErrorType.BadSwitchDefaultPosition,
			);
		}

		const statements = clause.getStatements();

		let lastStatement = statements[statements.length - 1];
		while (lastStatement && ts.TypeGuards.isBlock(lastStatement)) {
			const blockStatements = lastStatement.getStatements();
			lastStatement = blockStatements[blockStatements.length - 1];
		}
		const endsInReturnOrBreakStatement =
			lastStatement &&
			(ts.TypeGuards.isReturnStatement(lastStatement) || ts.TypeGuards.isBreakStatement(lastStatement));
		lastFallThrough = !endsInReturnOrBreakStatement;

		result += transpileStatementedNode(state, clause);

		if (!endsInReturnOrBreakStatement) {
			if (lastClauseIndex !== i) {
				result += state.indent + `${fallThroughVar} = true;\n`;
			}
		}

		if (isNonDefault) {
			state.popIndent();
			result += state.indent + `end;\n`;
		}
	});
	state.popIdStack();
	state.popIndent();
	result += state.indent + `until true;\n`;
	return result;
}
