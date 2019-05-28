export = () => {
	it("should understand string templates", () => {
		const value = "hello";
		expect(`"${value} world"`).to.equal('"hello world"');
		expect(`"${value}" world`).to.equal('"hello" world');
		expect(`${value} "world"`).to.equal('hello "world"');
		expect(`a${"b"}c${"d"}e`).to.equal("abcde");
	});

	it("should support tagged template expressions", () => {
		const OPERATIONS: { [index: string]: (a: Vector3, b: Vector3) => Vector3 } = {
			"*": (a, b) => a.mul(b),
			"/": (a, b) => a.div(b),
			"+": (a, b) => a.add(b),
			"-": (a, b) => a.sub(b),
		};

		function m(strings: TemplateStringsArray, ...operands: Vector3[]): Vector3 {
			const operators = strings.map(v => v.trim());

			let value = operands.shift()!;
			operators.shift();

			for (let i = 0; i < operands.length; i++) {
				const operator = operators[i].trim();
				if (operator in OPERATIONS) {
					const operation = OPERATIONS[operator];
					value = operation(value, operands[i]);
				}
			}

			return value;
		}

		const a = new Vector3(1, 2, 3);
		const b = new Vector3(4, 5, 6);
		const pos = m`${a} * ${b} - ${new Vector3(1, 2, 3)}`;

		expect(pos.X).to.equal(3);
		expect(pos.Y).to.equal(8);
		expect(pos.Z).to.equal(15);
	});
};