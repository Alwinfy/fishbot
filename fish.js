"use strict";

const {EventEmitter} = require("events");
const {BasicOptions} = require("./options");
const {DeckBuilder}  = require("./deckbuilder");
const {Deck}  = require("./deck");
const {Suit, Rank, Card}  = require("./card");

class FishSet {
	static ALL = Object.freeze((() => {
		const val = [];
		val.push(new FishSet("Jokers", [
			Card.cardFor(Rank.JOKER, Suit.SPADES),
			Card.cardFor(Rank.JOKER, Suit.HEARTS)
		]));
		for (let suit of Suit.ALL) {
			val.push(new FishSet(`Low ${suit.name}`, "TWO THREE FOUR FIVE SIX SEVEN".split(" ").map(r => Card.cardFor(suit, Rank[r]))));
			val.push(new FishSet(`High ${suit.name}`, "NINE TEN JACK QUEEN KING ACE".split(" ").map(r => Card.cardFor(suit, Rank[r]))));
		}
		return val;
	})());

	constructor(name, values) {
		this.name = name;
		this.abbreviation = name.replace(/[^A-Z]+/g, "");
		this.values = new Set(values);
	}
}

class FishPlayer extends EventEmitter {
	constructor(game, handle, hand, plugins) {
		this.game = game;
		this.handle = handle;
		this.hand = new Set(hand);
		this.on("takeCard", card => this.hand.add(card));
		this.on("giveCard", card => this.hand.remove(card));

		this.plugins = {};
		for(let p of plugins)
			this.plugins[p.name] = new p(this);
	}

	hasCard(card) {
		return card in this.hand;
	}

	takeFrom(card, other) {
		const had = other.has(card);
		if (had) {
			this.emit("takeCard", card);
			other.emit("giveCard", card);
		}
		else {
			this.emit("takeFail", card);
			other.emit("giveFail", card);
		}
		return had;
	}
}

class FishPlayerAnalyzerPlugin {
	static name = "analyzer";

	constructor(player) {
		this.player = player;
		this.has    = new Set(); // cards everyone knows I have
		this.hasNot = new Set(); // cards everyone knows I don't have
		this.hasSet = new Set(); //  sets everyone knows I have a card in, but not which

		player.on("takeCard", this.onTake.bind(this));
		player.on("giveCard", this.onGive.bind(this));
		player.on("takeFail", this.onTakeFail.bind(this));
		player.on("giveFail", this.onGiveFail.bind(this));
	}

	mustHaveSet(fishset) {
		for (let card of fishset.values)
			if (this.has.has(card))
				return true;
		return set in this.hasSet;
	}

	onTake(card) {
		this.has.add(card);
		this.hasNot.remove(card);
		this.hasSet.remove(FishSet.setFor(card));
	}

	onGive(card) {
		this.has.remove(card);
		this.hasNot.add(card);
		this.hasSet.remove(FishSet.setFor(card));
	}

	onTakeFail(card) {
		this.player.game.config.get("duplicates");
		const set = FishSet.setFor(card);
		if (!this.player.game.config.get("duplicates"))
			this.hasNot.add(card);
		if (!this.mustHaveSet(set))
			this.hasSet.add(set);
	}

	onGiveFail(card) {
		this.hasNot.add(card);
	}
}

class FishGameBuilder extends BasicOptions {
	started = false;

	constructor() {
		super([{
			key: "jokers",
			name: "Jokers",
			desc: "Whether Jokers are enabled for this game",
			value: false
		}, {
			key: "duplicates",
			name: "Duplicate Requests",
			desc: "Whether you're allowed to ask for a card you have",
			value: false
		}, {
			key: "bookkeeping",
			name: "Bookkeeping",
			desc: "Whether the game will track common knowledge",
			value: false
		}, {
			key: "chaos",
			name: "No Holds Barred",
			desc: "Whether players can ask for Any Card Whatsoever",
			value: false
		}]);
		this.teams = [new Set(), new Set()];
	}

	teamFor(handle) {
		for (const team of this.teams)
			if (team.has(handle))
				return team;
		return null;
	}

	addHandle(handle, side) {
		const teamid = side ? side - 1 : (this.teams[0].length > this.teams[1].length);
		const team = this.teams[teamid];
		if (team.has(handle)) return -1;
		removeHandle(handle);
		team.add(handle);
		return teamid;
	}

	removeHandle(handle) {
		const team = this.teamFor(handle);
		if (team) {
			team.remove(handle);
			return true;
		}
		return false;
	}

	totalPlayers() {
		let c = 0;
		for (const team of this.teams)
			c += team.size();
		return c;
	}

	build() {
		this.freeze();
		return new FishGame(this, this.teams);
	}
}

class FishGame {
	started = true;

	constructor(cfg, teams) {
		this.config = cfg;
		this.deck = new DeckBuilder().set("badRanks", [Rank.EIGHT]).set("hasJokers", cfg.get("jokers")).build();
		const hands = this.deck.partitionRemaining(cfg.totalPlayers());
		this.remainingSets = FishSet.ALL.slice(cfg.get("jokers"));

		const plugins = [];
		if (cfg.get("bookkeeping"))
			plugins.push(FishPlayerAnalyzerPlugin);
		this.players = this.handles.map(h => new FishPlayer(this, h, hands.pop(), plugins));
	}

}
