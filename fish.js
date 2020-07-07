"use strict";

const {EventEmitter} = require("events");
const {BasicOptions} = require("./options");
const {DeckBuilder}  = require("./deckbuilder");
const {Deck}  = require("./deck");
const {Suit, Rank, Card}  = require("./card");

class FishSuit {
	static ALL = Object.freeze((() => {
		const val = [];
		val.push(new FishSuit("Jokers", [
			Card.cardFor(Rank.JOKER, Suit.SPADES),
			Card.cardFor(Rank.JOKER, Suit.HEARTS)
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

	static suitFor(card) {
		for (const suit of FishSuit.ALL)
			if (suit.contains(card))
				return suit;
		return null;
	}
}

class FishPlayer extends EventEmitter {
	constructor(game, id, handle, hand, plugins) {
		this.game = game;
		this.team = null;
		this.id = id;
		this.handle = handle;
		this.hand = new Set(hand);
		this.on("giveCard", card => {
			this.hand.remove(card);
			this.emit("handChange", this.hand);
		});
		this.on("takeCard", card => {
			this.hand.add(card);
			this.emit("handChange", this.hand);
		});

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
		const hsuit = FishSuit.forCard(card).cards;
		for (const card of this.hand)
			if (hsuit.has(card))
				return true;
		return false;
	}

	requestables(card) {
		if (this.game.config.get("chaos"))
			return new Set(this.game.deck.cards);
		const cards = new Set();
		for (const card of this.hand)
			hsuits.add(FishSuit.forCard(card));
		for (const suit of hsuits)
			for (const card of suit)
				if (!this.hand.has(card) || this.game.config.get("duplicates"))
					cards.add(card);
		return cards;
	}

	takeFrom(card, other) {
		const had = other.has(card);
		if (had) {
			this.emit("takeCard", card);
			other.emit("giveCard", card);
		}
		else {
			this.emit("takeCardFail", card);
			other.emit("giveCardFail", card);
		}
		this.emit("turnEnd", had ? this : other);
		return had;
	}
}

class FishPlayerAnalyzerPlugin {
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
		this.hasNot.remove(card);
		this.hasSuit.remove(FishSuit.suitFor(card));
	}

	onGive(card) {
		this.has.remove(card);
		this.hasNot.add(card);
		this.hasSuit.remove(FishSuit.suitFor(card));
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
			key: "quick",
			name: "Quick Finish",
			desc: "Whether the game ends as soon as a team has 5+ halfsuits",
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

	addHandle(handle, side) {
		const teamid = ~side ? side : (this.teams[0].length > this.teams[1].length);
		const team = this.teams[teamid];
		if (team.has(handle)) return -1;
		this.removeHandle(handle);
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
		this.ownedSets = new Set();
		this.ordinal = i;
		this.opponent = null;
	}

	score() {
		return this.ownedSets.size();
	}
}

class FishGame extends EventEmitter {
	static ERR_WRONG_PLAYER = Symbol("It's not currently your turn!");
	static ERR_BAD_REQUEST  = Symbol("You can't request that right now!");
	static ERR_DECLARE_SIZE = Symbol("You've declared for the wrong number of cards!");
	static ERR_DECLARE_TEAM = Symbol("You can't declare a card held by an opponent!");
	static ERR_BAD_SELF     = Symbol("You don't have all the cards of that suit!");
	static ERR_EARLY_LIQUID = Symbol("It's too early for your team to liquidate!");
	static ERR_EARLY_PASS   = Symbol("You can still ask for cards!");
	static ERR_ENEMY_PASS   = Symbol("You can't pass your turn to the enemy!");

	static MIN_PLAYERS = 4;

	started = true;

	constructor(cfg, teams, plugins) {
		this.config = cfg;
		this.deck = new DeckBuilder().set("badRanks", [Rank.EIGHT]).set("hasJokers", cfg.get("jokers")).build();
		this.remainingSets = new Set(FishSuit.ALL.slice(cfg.get("jokers")));

		if (cfg.get("bookkeeping"))
			plugins.push(FishPlayerAnalyzerPlugin);
		this.players = [];
		this.teams = [];
		const hands = this.deck.partitionRemaining(cfg.totalPlayers());
		for (let i = 0; i < teams.length; i++) {
			const roster = [];
			for (const handle of teams[i]) {
				const player = new FishPlayer(this, h, hands.pop(), plugins);
				player.on("turnEnd", this.onTurnEnd.bind(this));
				this.players.push(player);
				roster.push(player);
			}
			this.teams.push(new FishTeam(roster, i));
		}
		this.teams[0].opponent = this.teams[1];
		this.teams[1].opponent = this.teams[0];
		this.players = this.handles.flat().map(h => new FishPlayer(this, h, hands.pop(), plugins));
		this.winScore = 1 + (0 | this.remainingSets / 2);
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
		const winner = this.endCondition();
		if (winner) {
			this.emit("gameEnd", winner);
			return;
		}
		this.currentPlayer.emit("turnStart");
	}

	endCondition() {
		const quickWinners = this.config.get("quick") && this.scores.filter(s => s >= this.winScore);
		if (quickWinners)
			return quickWinners;
		if (this.remainingSets.size())
			return null;
		if (this.teams[0].score() === this.teams[1].score())
			return this.teams;
		return this.teams[this.teams[0].score() < this.teams[1].score()];
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
		if (!dest.canRequest(card))
			throw FishGame.ERR_BAD_REQUEST;
		return dest.takeFrom(card, src);
	}

	liquidate(team) {
		for (const player of team.players)
			if (player.requestables().size() > 0)
				throw FishGame.ERR_EARLY_LIQUID;
		this.emit("liquidate", team);
		this.currentPlayer = null;
	}

	passTurn(giver, taker) {
		if (!this.isTurn(giver))
			throw FishGame.ERR_WRONG_PLAYER;
		if (!this.config.get("freepass") && giver.requestables().size() > 0)
			throw FishGame.ERR_EARLY_PASS;
		if (taker.team !== giver.team)
			throw FishGame.ERR_ENEMY_PASS;
		this.currentPlayer = taker;
		this.emit("turnPass", giver, taker);
		this.currentPlayer.emit("turnStart");
		return true;
	}

	declareSelf(declarer, suit) {
		for (const card of suit.cards)
			if (!declarer.hand.has(card))
				throw FishGame.ERR_BAD_SELF;
		return this.declare(declarer, suit, new Array(suit.cards.size()).map(_ => declarer));
	}

	declare(declarer, suit, players) {
		if (suit.cards.length != players.length) {
			throw FishGame.ERR_DECLARE_SIZE;
		}
		for (const player of players)
			if (player.team !== declarer.team)
				throw FishGame.ERR_DECLARE_TEAM;
		let success = true;
		for (let i = 0; i < set.cards.length; i++)
			if (!players[i].hasCard(set.cards[i])) {
				success = false;
				break;
			}
		const team = success ? player.team : player.team.opponent;
		team.scoredSets.add(suit);
		setTimeout(() => this.emit("scoreSet", suit, team));
		return success;
	}

	removeSuit(suit) {
		const affected = new Set();
		for (const card of suit.cards)
			for (const player of this.players)
				if (player.hand.has(card)) {
					player.hand.remove(card);
					affected.add(player);
				}
		for (const player of affected)
			player.emit("handChange", player.hand);
		this.remainingSuits.remove(suit);
	}
}
