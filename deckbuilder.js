"use strict";

const {BasicOptions} = require('./options');
const {Deck} = require('./deck');
const {Suit, Rank, Card} = require('./card');

// Configurable builder for a Deck of Cards.
class DeckBuilder extends BasicOptions {
	constructor() {
		super([{
			key: "badCards",
			name: "Blacklisted Cards",
			desc: "Cards you'd like to leave out of the deck",
			value: [],
			predicate: BasicOptions.validateList(Card)
		}, {
			key: "badSuits",
			name: "Blacklisted Suits",
			desc: "Suits you'd like to leave out of the deck",
			value: [],
			predicate: BasicOptions.validateList(Suit)
		}, {
			key: "badRanks",
			name: "Blacklisted Ranks",
			desc: "Ranks you'd like to leave out of the deck",
			value: [],
			predicate: BasicOptions.validateList(Rank)
		}, {
			key: "hasJokers",
			name: "Jokers",
			desc: "Whether Jokers are enabled in this deck",
			value: true
		}, {
			key: "autodiscard",
			name: "Automatic Discarding",
			desc: "whether this deck should automatically put dealt cards in the discard pile",
			value: false
		}, {
			key: "autosort",
			name: "Automatic Sorting",
			desc: "whether this deck should automatically sort dealt cards",
			value: true
		}]);
	}

	build() {
		const cards = [];
		for (const card of Card.ALL) {
			const bad = ~this.get("badCards").indexOf(card)
			         || (card.rank === Rank.JOKER ? !this.get("hasJokers")
			                  : ~this.get("badSuits").indexOf(card.suit)
			                 || ~this.get("badRanks").indexOf(card.rank));
			if (!bad) cards.push(card);
		}
		return new Deck(cards, this.get("autodiscard"), this.get("autosort"));
	}
}

module.exports = {DeckBuilder};

if(require.main === module) {
	const deck = new DeckBuilder().set("hasJokers", false).set("badRanks", [Rank.EIGHT]).build().shuffle();
	console.dir(deck.partitionRemaining(6).map(x => x.map(y => y.toString())));
}
