"use strict";

const {EventEmitter} = require("events");
const {BasicOptions} = require("./options");
const {DeckBuilder}  = require("./deckbuilder");
const {Suit, Rank, Card}  = require("./card");

class FishError extends Error {
	constructor(str) {
		super(str);
		this.str = str;
	}

	toString() {
		return this.str;
	}
}

class FishSuit {
	static ALL = Object.freeze((() => {
		const val = [];
		val.push(new FishSuit("Jokers", [
			Card.cardFor(Suit.SPADES, Rank.EIGHT),
			Card.cardFor(Suit.HEARTS, Rank.EIGHT),
			Card.cardFor(Suit.DIAMONDS, Rank.EIGHT),
			Card.cardFor(Suit.HEARTS, Rank.EIGHT),
			Card.cardFor(Suit.SPADES, Rank.JOKER),
			Card.cardFor(Suit.HEARTS, Rank.JOKER)
		]));
		for (let suit of Suit.ALL) {
			val.push(new FishSuit(`Low ${suit.name}`, "TWO THREE FOUR FIVE SIX SEVEN".split(" ").map(r => Card.cardFor(suit, Rank[r]))));
			val.push(new FishSuit(`High ${suit.name}`, "NINE TEN JACK QUEEN KING ACE".split(" ").map(r => Card.cardFor(suit, Rank[r]))));
		}
		return val;
	})());

	constructor(name, cards) {
		this.name = name;
		this.abbreviation = name.replace(/[^A-Z]+/g, "");
		this.cards = cards;
		Object.freeze(this);
	}

	contains(card) {
		return !!~this.cards.indexOf(card);
	}

	toString() {
		return this.name;
	}

	static suitFor(card) {
		for (const suit of FishSuit.ALL)
			if (suit.contains(card))
				return suit;
		return null;
	}
}

class FishPlayer extends EventEmitter {
	constructor(game, handle, hand, plugins) {
		super();
		this.game = game;
		this.team = null;
		this.handle = handle;
		this.hand = new Set(hand);
		this.on("giveCard", card => {
			this.hand.delete(card);
		});
		this.on("takeCard", card => {
			this.hand.add(card);
		});
		this.on("loseSuit", this.removeSuit);

		this.plugins = {};
		for (let p of plugins)
			this.plugins[p.pluginName] = new p(this);
	}

	hasCard(card) {
		return this.hand.has(card);
	}

	canRequest(card) {
		if (this.game.config.get("chaos"))
			return card in this.game.deck.cards;
		if (!this.game.config.get("duplicates") && this.hand.has(card))
			return false;
		const hsuit = FishSuit.suitFor(card).cards;
		if (!hsuit) return false;
		for (const card of hsuit)
			if (this.hand.has(card))
				return true;
		return false;
	}

	requestables() {
		if (this.game.config.get("chaos"))
			return new Set(this.game.deck.cards);
		const cards = new Set();
		const hsuits = new Set();
		for (const card of this.hand)
			hsuits.add(FishSuit.suitFor(card));
		for (const suit of hsuits)
			for (const card of suit.cards)
				if (!this.hand.has(card) || this.game.config.get("duplicates"))
					cards.add(card);
		return cards;
	}

	takeFrom(card, other) {
		const had = other.hand.has(card);
		if (had) {
			this.emit("takeCard", card);
			this.emit("handChange", this.hand);
			other.emit("giveCard", card);
			other.emit("handChange", other.hand);
		}
		else {
			this.emit("takeCardFail", card);
			other.emit("giveCardFail", card);
		}
		this.emit("turnEnd", had ? this : other);
		return had;
	}

	removeSuit(suit) {
		let affected = false;
		for (const card of suit.cards)
			if (this.hand.has(card)) {
				this.emit("giveCard", card);
				affected = true;
			}
		if (affected)
			this.emit("handChange", this.hand);
	}
}

class FishPlayerAnalyzerPlugin {
	static pluginName = "analyzer";

	constructor(player) {
		this.player = player;
		this.has    = new Set(); // cards everyone knows I have
		this.hasNot = new Set(); // cards everyone knows I don't have
		this.hasSuit = new Set(); // suits everyone knows I have a card in, but not which

		player.on("takeCard", this.onTake.bind(this));
		player.on("giveCard", this.onGive.bind(this));
		player.on("takeFail", this.onTakeFail.bind(this));
		player.on("giveFail", this.onGiveFail.bind(this));
	}

	mustHaveSet(hsuit) {
		for (let card of hsuit.cards)
			if (this.has.has(card))
				return true;
		return hsuit in this.hasSuit;
	}

	onTake(card) {
		this.has.add(card);
		this.hasNot.delete(card);
		this.hasSuit.delete(FishSuit.suitFor(card));
	}

	onGive(card) {
		this.has.delete(card);
		this.hasNot.add(card);
		this.hasSuit.delete(FishSuit.suitFor(card));
	}

	onTakeFail(card) {
		this.player.game.config.get("duplicates");
		if (!this.player.game.config.get("duplicates"))
			this.hasNot.add(card);
		const suit = FishSuit.suitFor(card);
		if (!this.mustHaveSet(suit))
			this.hasSuit.add(suit);
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
			value: true
		}, {
			key: "quick",
			name: "Quick Finish",
			desc: "Whether the game ends as soon as a team has 5+ halfsuits",
			value: false
		}, {
			key: "bookkeeping",
			name: "Bookkeeping",
			desc: "Whether the game will track common knowledge",
			value: false
		}, {
			key: "freepass",
			name: "Free Passing",
			desc: "Whether players can pass their turn at any time",
			value: false
		}, {
			key: "enemypass",
			name: "Enemy Passing",
			desc: "Whether players can pass their turn to opponents",
			value: false
		}, {
			key: "countercall",
			name: "Countercalling",
			desc: "Whether you're allowed to declare opposing teams' half-suits",
			value: false
		}, {
			key: "duplicates",
			name: "Duplicate Requests",
			desc: "Whether you're allowed to ask for a card you have",
			value: false
		}, {
			key: "chaos",
			name: "No Holds Barred",
			desc: "Whether players can ask for Any Card Whatsoever with absolutely no penalty",
			value: false
		}]);
		this.teams = [new Set(), new Set()];
	}

	getPlayers() {
		return this.teams.flatMap(Array.from);
	}

	teamFor(handle) {
		for (const team of this.teams)
			if (team.has(handle))
				return team;
		return null;
	}

	effectiveSide(handle) {
		if (this.teams[0].has(handle)) return 1;
		if (this.teams[1].has(handle)) return 0;
		return +(this.teams[0].size > this.teams[1].size);
	}

	addHandle(handle, side) {
		const teamid = ~side ? side : this.effectiveSide(handle);
		const team = this.teams[teamid];
		if (team.has(handle)) return -1;
		this.removeHandle(handle);
		team.add(handle);
		return teamid;
	}

	removeHandle(handle) {
		const team = this.teamFor(handle);
		if (team) {
			team.delete(handle);
			return true;
		}
		return false;
	}

	totalPlayers() {
		let c = 0;
		for (const team of this.teams)
			c += team.size;
		return c;
	}

	build(extraPlugins) {
		this.freeze();
		return new FishGame(this, this.teams, extraPlugins);
	}
}

class FishTeam {
	constructor(players, i) {
		this.players = new Set(players);
		for (const player of players)
			player.team = this;
		this.ownedSuits = new Set();
		this.ordinal = i;
		this.opponent = null;
	}

	score() {
		return this.ownedSuits.size;
	}
}

class FishGame extends EventEmitter {
	static ERR_WRONG_PLAYER = new FishError("It's not currently your turn.");
	static ERR_BAD_REQUEST  = new FishError("You're not allowed to request that right now.");
	static ERR_TEAM_REQUEST = new FishError("You can't request a card from someone on your team.");
	static ERR_DECLARE_SIZE = new FishError("You've declared for the wrong number of cards.");
	static ERR_DECLARE_HOMO = new FishError("Not everyone that you declared was on the same team.");
	static ERR_DECLARE_TEAM = new FishError("You can't declare a card held by an opponent.");
	static ERR_BAD_SELFDEC  = new FishError("You don't have all the cards of that half-suit.");
	static ERR_EARLY_LIQUID = new FishError("Some of your team members still have cards.");
	static ERR_EARLY_PASS   = new FishError("You still have cards.");
	static ERR_RECUR_PASS   = new FishError("You can't pass your turn to someone who's out of cards.");
	static ERR_ENEMY_PASS   = new FishError("You can't pass your turn to the opposing team.");

	static MIN_PLAYERS = 4;

	started = true;

	constructor(cfg, teams, plugins) {
		super();
		this.config = cfg;
		this.deck = new DeckBuilder().set("badRanks", cfg.get("jokers") ? [] : [Rank.EIGHT]).set("hasJokers", cfg.get("jokers")).build().shuffle();
		this.remainingSuits = new Set(FishSuit.ALL.slice(+!cfg.get("jokers")));
		this.finished = false;

		if (cfg.get("bookkeeping"))
			plugins.push(FishPlayerAnalyzerPlugin);
		this.players = [];
		this.teams = [];
		const hands = this.deck.partitionRemaining(cfg.totalPlayers());
		for (let i = 0; i < teams.length; i++) {
			const roster = [];
			for (const handle of teams[i]) {
				const player = new FishPlayer(this, handle, hands.pop(), plugins);
				player.on("turnEnd", this.onTurnEnd.bind(this));
				this.players.push(player);
				roster.push(player);
			}
			this.teams.push(new FishTeam(roster, i));
		}
		this.teams[0].opponent = this.teams[1];
		this.teams[1].opponent = this.teams[0];
		this.winScore = 1 + (0 | this.remainingSuits / 2);
		this.currentPlayer = this.players[0 | Math.random() * this.players.length];
		setTimeout(() => this.begin());
	}

	begin() {
		this.emit("gameBegin", this);
		this.currentPlayer.emit("turnStart");
	}

	isTurn(player) {
		return player === this.currentPlayer;
	}

	onTurnEnd(nextPlr) {
		this.currentPlayer = nextPlr;
		this.currentPlayer.emit("turnStart");
	}

	checkEnd() {
		if (this.finished) return true;
		const winner = this.endCondition();
		if (winner) {
			setTimeout(() => this.emit("gameEnd", winner));
			return this.finished = true;
		}
		return false;
	}

	endCondition() {
		const quickWinners = this.config.get("quick") && this.teams.filter(t => t.score() >= this.winScore);
		if (quickWinners)
			return quickWinners;
		if (this.remainingSuits.size)
			return null;
		if (this.teams[0].score() === this.teams[1].score())
			return this.teams;
		return [this.teams[+(this.teams[0].score() < this.teams[1].score())]];
	}

	playerFor(handle) {
		for (const player of this.players)
			if (player.handle === handle)
				return player;
		return null;
	}

	teamFor(player) {
		for (const team in this.teams)
			if (team.players.has(player))
				return team;
		return null;
	}

	moveCard(src, dest, card) {
		if (!this.isTurn(dest))
			throw FishGame.ERR_WRONG_PLAYER;
		if (src.team === dest.team)
			throw FishGame.ERR_TEAM_REQUEST;
		if (!dest.canRequest(card))
			throw FishGame.ERR_BAD_REQUEST;
		return dest.takeFrom(card, src);
	}

	liquidate(team) {
		for (const player of team.players)
			if (player.hand.size > 0)
				throw FishGame.ERR_EARLY_LIQUID;
		this.emit("liquidate", team);
		this.currentPlayer = null;
	}

	passTurn(giver, taker) {
		if (!this.isTurn(giver))
			throw FishGame.ERR_WRONG_PLAYER;
		if (!this.config.get("freepass") && giver.hand.size > 0)
			throw FishGame.ERR_EARLY_PASS;
		if (!taker.requestables().size)
			throw FishGame.ERR_RECUR_PASS;
		if (!this.config.get("enemypass") && taker.team !== giver.team)
			throw FishGame.ERR_ENEMY_PASS;
		this.currentPlayer = taker;
		this.emit("turnPass", giver, taker);
		this.currentPlayer.emit("turnStart");
		return true;
	}

	declareSelf(declarer, suit) {
		for (const card of suit.cards)
			if (!declarer.hand.has(card))
				throw FishGame.ERR_BAD_SELFDEC;
		return this.declare(declarer, suit, suit.cards.map(_ => declarer));
	}

	declare(declarer, suit, players) {
		if (suit.cards.length !== players.length) {
			throw FishGame.ERR_DECLARE_SIZE;
		}
		for (const player of players)
			if (player.team !== (this.config.get("countercall") ? players[0] : declarer).team)
				throw this.config.get("countercall") ? FishGame.ERR_DECLARE_HOMO : FishGame.ERR_DECLARE_TEAM;
		let success = true;
		for (let i = 0; i < suit.cards.length; i++)
			if (!players[i].hasCard(suit.cards[i])) {
				success = false;
				break;
			}
		const team = success ? declarer.team : declarer.team.opponent;
		this.removeSuit(suit);
		team.ownedSuits.add(suit);
		setTimeout(() => this.emit("scoreSet", suit, team));
		this.checkEnd();
		return success;
	}

	removeSuit(suit) {
		for (const player of this.players)
			player.emit("loseSuit", suit);
		this.remainingSuits.delete(suit);
	}
}

module.exports = {FishError, FishSuit, FishGame, FishGameBuilder};
