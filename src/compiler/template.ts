import * as ts from "ts-morph";
import { compileExpression, compileList } from ".";
import { CompilerState } from "../CompilerState";
import { skipNodesDownwards } from "../utility/general";
import { getType, isStringType } from "../utility/type";

export function sanitizeTemplate(str: string) {
	str = str.replace(/(^|[^\\](?:\\\\)*)"/g, '$1\\"'); // replace " with \"
	str = str.replace(/(\r?\n|\r)/g, "\\$1"); // prefix new lines with \
	return str;
}

function wrapQuotes(s: string) {
	return `"${s}"`;
}

interface TemplateParts {
	literals: Array<string>;
	expressions: Array<string>;
}

function getTemplateParts(
	state: CompilerState,
	node: ts.TemplateExpression | ts.NoSubstitutionTemplateLiteral,
	tostring: boolean,
): TemplateParts {
	if (ts.TypeGuards.isNoSubstitutionTemplateLiteral(node)) {
		return {
			expressions: [],
			literals: [wrapQuotes(sanitizeTemplate(node.getText().slice(1, -1)))],
		};
	} else {
		const literals = [
			wrapQuotes(
				sanitizeTemplate(
					node
						.getHead()
						.getText()
						.slice(1, -2),
				),
			),
		];

		for (const span of node.getTemplateSpans()) {
			const literal = span.getLiteral();
			literals.push(
				wrapQuotes(
					sanitizeTemplate(literal.getText().slice(1, ts.TypeGuards.isTemplateMiddle(literal) ? -2 : -1)),
				),
			);
		}

		const expressions = compileList(
			state,
			node.getTemplateSpans().map(span => skipNodesDownwards(span.getExpression())),
			(_, exp) => {
				const expStr = compileExpression(state, exp);
				if (tostring) {
					return isStringType(getType(exp)) ? expStr : `tostring(${expStr})`;
				} else {
					return expStr;
				}
			},
		);

		return {
			expressions,
			literals,
		};
	}
}

export function compileTemplateExpression(state: CompilerState, node: ts.TemplateExpression) {
	const parts = getTemplateParts(state, node, true);

	const bin = new Array<string>();
	for (let i = 0; i < parts.expressions.length; i++) {
		bin.push(parts.literals[i]);
		bin.push(parts.expressions[i]);
	}
	bin.push(parts.literals[parts.literals.length - 1]);

	return bin.filter(v => v !== `""`).join(" .. ");
}

export function compileTaggedTemplateExpression(state: CompilerState, node: ts.TaggedTemplateExpression) {
	const tagStr = compileExpression(state, skipNodesDownwards(node.getTag()));
	const parts = getTemplateParts(state, node.getTemplate(), false);
	if (parts.expressions.length > 0) {
		return `${tagStr}({ ${parts.literals.join(", ")} }, ${parts.expressions.join(", ")})`;
	} else {
		return `${tagStr}({ ${parts.literals.join(", ")} })`;
	}
}
