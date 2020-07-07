"use strict";

// Util classes for card representation.
class Suit {
	static ALL	= [];

	static SPADES	= new Suit("\u2664", "Spades",	 false);
	static HEARTS	= new Suit("\u2661", "Hearts",	 true);
	static DIAMONDS = new Suit("\u2662", "Diamonds", true);
	static CLUBS	= new Suit("\u2667", "Clubs",	 false);

	constructor(c, name, red) {
		this.character = c;
		this.name = name;
		this.red = red;
		this.ordinal = Suit.ALL.length;
		if (this.ordinal >= 4)
			throw new Error("only 4 suits. no touchy");
		Object.freeze(this);
		Suit.ALL.push(this);
	}

	getColor() {
		return this.red ? "Red" : "Black";
	}

	toString() {
		return this.name;
	}
}

class Rank {
	static ALL   = [];
	static _cnt  = 0;

	static ACE   = new Rank("Ace",   "A");
	static TWO   = new Rank("Two",   "2");
	static THREE = new Rank("Three", "3");
	static FOUR  = new Rank("Four",  "4");
	static FIVE  = new Rank("Five",  "5");
	static SIX   = new Rank("Six",   "6");
	static SEVEN = new Rank("Seven", "7");
	static EIGHT = new Rank("Eight", "8");
	static NINE  = new Rank("Nine",  "9");
	static TEN   = new Rank("Ten",   "10");
	static JACK  = new Rank("Jack",  "J");
	static QUEEN = new Rank("Queen", "Q");
	static KING  = new Rank("King",  "K");
	static JOKER = new Rank("Joker", "*");

	constructor(name, abbr) {
		this.name = name;
		this.abbr = abbr;
		this.ordinal = Rank.ALL.length;
		if (this.ordinal >= 14)
			throw new Error("only 13 ranks (+ joke). no touchy");
		Object.freeze(this);
		Rank.ALL.push(this);
	}

	toString() {
		return this.name;
	}
}

class Card {
	static ALL = Object.freeze((() => {
		const val = [];
		for(let i = 0; i < 52; i++)
			val.push(new Card(Suit.ALL[0 | i / 13], Rank.ALL[i % 13]));
		val.push(new Card(Suit.SPADES, Rank.JOKER));
		val.push(new Card(Suit.HEARTS, Rank.JOKER));
		
		return val;
	})());

	constructor(suit, rank) {
		if (suit.ordinal >= 2 && rank === Rank.JOKER)
			throw new Error("Please only construct jokers with low suits!");
		this.suit = suit;
		this.rank = rank;
		this.ordinal = (rank.ordinal === 13 ? 52 + suit.ordinal : 13 * suit.ordinal + rank.ordinal);
		Object.freeze(this);
	}

	static cardFor(suit, rank) {
		return Card.ALL[rank === Rank.JOKER ? 52 + suit.ordinal : 13 * suit.ordinal + rank.ordinal];
	}

	toString() {
		return this.rank === Rank.JOKER
			? `${this.suit.getColor()} ${this.rank.name}`
			: `${this.rank.name} of ${this.suit.name}`;
	}
	toAbbr() {
		return this.rank === Rank.JOKER
			? `${this.suit.getColor()[0]}Jo`
			: `${this.rank.abbr}${this.suit.character}`;
	}
}

module.exports = {Suit, Rank, Card};

