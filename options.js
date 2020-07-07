"use strict";

// Classes for setting/getting options.
class Options {
	getListing() {
		return [];
	}

	nameFor(key) {
		throw new Error(`Don't know name for undefined option: ${key}`);
	}

	descriptionFor(key) {
		throw new Error(`Don't know description for undefined option: ${key}`);
	}

	has(key) {
		return !!~this.getListing().indexOf(key);
	}

	set(key, value) {
		throw new Error(`Don't know how to set undefined option: ${key}`);
	}

	get(key) {
		throw new Error(`Don't know how to get undefined option: ${key}`);
	}
}

class BasicOptions extends Options {
	// Takes opt spec of form [{key: "key", name: "nullable short name", desc: "nullable long name", value: "default value", "predicate": val => isValid(val)}]
	constructor(options) {
		super();
		this.names = {};
		this.descs = {};
		this.preds = {};
		this.data = {};
		this.listing = [];
		this.frozen = false;

		for (let obj of options) {
			const key = obj.key;
			if (!key)
				throw new Error(`Bad option spec: No attr 'key' on object ${obj}`);

			this.listing.push(key);
			this.names[key] = obj.name || key;
			this.descs[key] = obj.desc || "";
			this.preds[key] = obj.predicate || (_ => true);
			this.data[key]  = obj.value || null;
		}
	}

	getListing() {
		return this.listing;
	}

	nameFor(key) {
		return key in this.names ? this.names[key] : super.nameFor(key);
	}

	descriptionFor(key) {
		return key in this.descs ? this.descs[key] : super.descriptionFor(key);
	}

	freeze() {
		Object.freeze(this.data);
	}

	set(key, value) {
		if (!(key in this.data))
			super.set(key, value);
		if (!this.preds[key](value))
			throw new Error(`Value ${value} doesn't satisfy predicate for ${key} in ${this}!`);
		this.data[key] = Object.freeze(value);
		return this;
	}

	get(key) {
		return key in this.data ? this.data[key] : super.get(key);
	}

	// Helper methods for predicates
	static validate(clazz) {
		return obj => obj instanceof clazz;
	}

	static validateList(clazz) {
		return list => list.every(this.validate(clazz));
	}
}

module.exports = {Options, BasicOptions};
