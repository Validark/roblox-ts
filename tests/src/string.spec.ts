export = () => {
	it("should support string methods", () => {
		expect("Hello, world".sub(0, 0)).to.equal("H");
	});

	it("should support string methods on identifiers", () => {
		const str = "Hello, world";
		expect(str.sub(0, 0)).to.equal("H");
	});

	it("should support string.slice", () => {
		const str = "Hello, world";
		expect(str.slice(0, 1)).to.equal("H");
		expect("Hello, world".slice(0, 1)).to.equal("H");
	});

	it("should support string.split", () => {
		function checkLen<T>(len: number, arr: Array<T>) {
			expect(arr.size()).to.equal(len);
			return arr;
		}

		const str = "Hello, world";
		const chars = str.byte(0, -1).map(i => string.char(i));
		const words = ["Hello", "world"];
		const hSplit = ["", "ello, world"];

		expect(str.split("").every((char, i) => char === chars[i])).to.equal(true);
		expect(str.split(", ").every((word, i) => word === words[i])).to.equal(true);
		expect(str.split("H").every((word, i) => word === hSplit[i])).to.equal(true);
		expect(checkLen(1, "".split("a"))[0]).to.equal("");

		for (let i = 2; i < 10; i++) {
			const str = "d".rep(i - 1);
			const str1 = str.split("d");
			expect(str1.size()).to.equal(i);
			expect(str1.every(c => c === "")).to.equal(true);
		}

		expect("".split("").isEmpty()).to.equal(true);

		const slasher = ["", "Validark", "Osyris", "Vorlias", ""];
		expect(checkLen(5, "/Validark/Osyris/Vorlias/".split("/")).every((word, i) => word === slasher[i])).to.equal(
			true,
		);
		expect(checkLen(4, "Validark/Osyris/Vorlias/".split("/")).every((word, i) => word === slasher[i + 1])).to.equal(
			true,
		);
		expect(checkLen(3, "Validark/Osyris/Vorlias".split("/")).every((word, i) => word === slasher[i + 1])).to.equal(
			true,
		);
	});

	it("should support calling gmatch", () => {
		expect("Hello".gmatch(".")()).to.equal("H");
	});

	it("should support the spread operator on strings", () => {
		const array4 = ["H", "i", "y", "a"];
		expect([..."Hiya"].every((x, i) => x === array4[i])).to.equal(true);
	});

	it("should support string.find", () => {
		const data = "Hello".find("H", 0, true);
		if (data[0]) {
			expect(data[0]).to.equal(0);
			expect(data[1]).to.equal(0);
		}

		const data2 = "Hello".find("e", 1, true);
		if (data2[0]) {
			expect(data2[0]).to.equal(1);
			expect(data2[1]).to.equal(1);
		}
	});

	it("should support concatenating strings", () => {
		expect("a" + 1 + true + false).to.equal("a1truefalse");
	});
};
