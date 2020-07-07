"use strict";

// A deck of things.
class Deck {
	constructor(cards, autodiscard, autosort) {
		this.cards = cards;
		Object.freeze(this.cards);

		this.pile = Array.from(this.cards);
		this.dpile = [];
		this.autodiscard = autodiscard;
		this.autosort = autosort;
	}

	reset() {
		this.pile = this.pile.concat(this.dpile);
		this.dpile = [];
		return this;
	}

	shuffle() {
		this.reset();
		Deck.shuffleList(this.pile);
		return this;
	}

	size() {
		return this.pile.length;
	}

	discardSize() {
		return this.dpile.length;
	}

	discard(cards) {
		this.dpile = this.dpile.concat(cards);
	}

	dealSome(count) {
		const stack = this.pile.slice(0, count);
		this.pile = this.pile.slice(count);
		if (this.autodiscard)
			this.discard(stack);
		return this.autosort ? Deck.sortCards(stack) : stack;
	}

	dealOne() {
		const deal = this.dealSome(1);
		return deal.length ? deal[0] : null;
	}

	deal(count) {
		let stack = this.dealSome(count);
		while (stack.length < count) {
			if (!discardSize())
				throw new Error(`Deck out of cards after ${stack.length} drawn (${count} requested).`);
			this.shuffle();
			stack = stack.concat(this.dealSome(count - stack.length));
		}
		return stack;
	}

	takeRemaining() {
		return this.dealSome(this.size);
	}

	partitionRemaining(count) {
		const partitions = [];
		while (count)
			partitions.push(this.dealSome(0 | this.size() / count--));
		return Deck.shuffleList(partitions);
	}

	static sortCards(cards) {
		return cards.sort((a, b) => a.ordinal - b.ordinal);
	}

	static shuffleList(list) {
		for (let i = 0; i < list.length; i++) {
			const j = i + (0 | Math.random() * (list.length - i));
			const tmp = list[i];
			list[i] = list[j];
			list[j] = tmp;
		}
		return list;
	}
}

module.exports = {Deck};
