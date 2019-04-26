import * as ts from "ts-morph";
import { transpileStatementedNode } from ".";
import { CompilerState } from "../CompilerState";
import { CompilerError, CompilerErrorType } from "../errors/CompilerError";
import { getScriptContext, getScriptType, ScriptType } from "../utility";

const { version: VERSION } = require("./../../package.json") as {
	version: string;
};

export function transpileSourceFile(state: CompilerState, node: ts.SourceFile) {
	console.profile(node.getBaseName());

	state.scriptContext = getScriptContext(node);
	const scriptType = getScriptType(node);
	let result = transpileStatementedNode(state, node);
	if (state.isModule) {
		if (scriptType !== ScriptType.Module) {
			throw new CompilerError(
				"Attempted to export in a non-ModuleScript!",
				node,
				CompilerErrorType.ExportInNonModuleScript,
			);
		}

		let hasExportEquals = false;
		for (const descendant of node.getDescendantsOfKind(ts.SyntaxKind.ExportAssignment)) {
			if (descendant.isExportEquals()) {
				hasExportEquals = true;
				break;
			}
		}

		if (hasExportEquals) {
			result = state.indent + `local _exports;\n` + result;
		} else {
			result = state.indent + `local _exports = {};\n` + result;
		}
		result += state.indent + "return _exports;\n";
	} else {
		if (scriptType === ScriptType.Module) {
			result += state.indent + "return nil;\n";
		}
	}
	if (state.usesTSLibrary) {
		result =
			`local TS = require(
	game:GetService("ReplicatedStorage")
		:WaitForChild("RobloxTS")
		:WaitForChild("Include")
		:WaitForChild("RuntimeLib")
);\n` + result;
	}

	const CURRENT_TIME = new Date().toLocaleString("en-US", {
		day: "numeric",
		hour: "numeric",
		hour12: true,
		minute: "numeric",
		month: "long",
		timeZoneName: "long",
		year: "numeric",
	});

	const GENERATED_HEADER = `-- Generated by https://roblox-ts.github.io v${VERSION}
-- Compiled ${CURRENT_TIME}

`;

	result = GENERATED_HEADER + result;
	console.profileEnd();
	return result;
}