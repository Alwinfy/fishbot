"use strict";

const {FishGameBuilder} = require('./fish');
const {Suit, Rank, Card} = require('./card');

const toss = err => {throw err};

class FishBotParser {
	constructor(bot) {
		this.bot = bot;
	}

	checkPrefix(msg) {
		const trimmed = msg.content.replace(/^\s+/, '');
		return trimmed.startsWith(this.prefix)
			? trimmed.substring(0, this.prefix.length) : null;
	}

	parseRank(str) {
		if (+str)
			return Rank.ALL[+str - 1];
		const index = "jqka".indexOf(str[0]);
		if (~index)
			return [Rank.JACK, Rank.QUEEN, Rank.KING, Rank.ACE][index];
		for (const rank of Rank.ALL)
			if (rank !== Rank.JOKER && str.startsWith(rank.name.toLowerCase()))
				return rank;
		return null;
	}

	parseSuit(str) {
		for (const suit of Suit.ALL)
			if (suit.character === str[0] || suit.name[0].toLowerCase() === str[0])
				return suit;
		return null;
	}

	parseCards(msg) {
		const CARD_RE = /\b(10\|[1-79]\|[a-z]+)(?:\b|\s*o[f']?\s*)([\u2660-\u2663hscd])|\b([rb][a-z]*\s*j)/i;
		const hits = [];
		for (const match of CARD_RE.matchAll(msg.content.toLowerCase())) {
			if (match[3]) {
				hits.push(Card.cardFor(match[3][0] === "r" ? Suit.HEARTS : Suit.SPADES, Rank.JOKER));
				continue;
			}
			const rank = this.parseRank(match[1]);
			const suit = this.parseSuit(match[2]);
			if (rank && suit)
				hits.push(Card.cardFor(suit, rank));
		}
		return hits;
	}
}

class FishBotCommands {
	static CODE_PREFIX = "cmd_";

	static COMMANDS = {
		"join": "Join the game in the current channel",
		"leave": "Leave the game in the current channel",
		"common": "Get common knowledge about a player, if `bookkeeping` is enabled",
	};
	static ALIASES = {
		"join": ["in"],
		"leave": ["out"],
		"common": ["ck"]
	};

	static ERR_NO_GAME     = Symbol("No game is happening in this channel!");
	static ERR_NOT_STARTED = Symbol("The game hasn't started yet!");
	static ERR_NO_PLAYER   = Symbol("You aren't playing in this game!");

	constructor(bot) {
		this.bot = bot;
		this.docstrings = [];
		this.commands = {};
		for (const cmd in FishBotCommands.COMMANDS) {
			this.commands[cmd] = this[FishBotCommands.CODE_PREFIX + cmd].bind(this);
			let snipsize;
			for (snipsize = 1; snipsize < cmd.length; snipsize++) {
				const snip = cmd.substring(0, snipsize);
				if (!(snip in this.commands)) {
					this.commands[snip] = this.commands[cmd];
					break;
				}
			}
			let docstring = `**${snipsize === cmd.length ? cmd : `__${cmd.substring(0, snipsize)}__${cmd.substring(snipsize)}`}** - ${FishBotCommands.COMMANDS[cmd]}`;
			if (cmd in FishBotCommands.ALIASES) {
				for (const alias of FishBotCommands.ALIASES[cmd])
					this.commands[alias] = this.commands[cmd];
				docstring += ` (aliases: ${FishBotCommands.ALIASES[cmd].join(", ")})`;
			}
			this.docstrings.push(docstring);
		}
	}

	


	activePlayerFor(msg) {
		const game = this.bot.gameFor(msg) || toss(FishBotCommands.ERR_NO_GAME);
		if (!game.started)
			throw FishBotCommands.ERR_NOT_STARTED;
		return game.getPlayer(msg.author.id) || toss(FishBotCommands.ERR_NO_PLAYER);
	}

	process(msg, cmd, args) {
		if (!(cmd in this.commands))
			return;
		try {
			this.commands[cmd](msg, args);
		} catch (e) {
			if (e instanceof Symbol)
				msg.channel.send(`Error: ${e.toString()}`);
			else
				throw e;
		}
	}

	renderCards(cardset) {
		const list = Deck.sortCards(Array.from(cardset));
		if (list.length < 6)
			return renderList(list);
		return list.map(c => c.toAbbr()).join(" ");
	}

	renderList(list) {
		switch (list.length) {
		case 0: return "None";
		case 1: return list[0].toString();
		case 2: return `${list[0]} and ${list[1]}`;
		}
		const last = list.pop();
		return `${list.join(", ")}, and ${last}`;
	}

	renderPlayer(plr) {
		return `<@${plr.handle}>`;
	}

	cmd_join(msg) {
		const game = this.bot.gameFor(msg);
		if (game) {
			if (game.started)
				return msg.channel.send(`Too late to join, game has already started.`);
			const side = game.addHandle(msg.author.id);
			msg.channel.send(`${msg.author} has joined this game of Fish.`);
		} else {
			this.bot.games[msg.channel.id] = new FishGameBuilder();
			msg.channel.send(`${msg.author} has created a game of Fish. Type ${this.bot.prefix}join to join.`);
		}
	}

	cmd_leave(msg) {
		const game = this.bot.gameFor(msg) || toss(FishBotCommands.ERR_NO_GAME);
	}

	cmd_start(msg) {
		
	}

	cmd_swap(msg) {
		
	}

	cmd_common(msg) {
		const player = this.activePlayerFor(msg);
		const data = [
			`has ${player.hand.size()} cards`
		];
		const analyzer = player.plugins.analyzer;
		if (analyzer) {
			data = data.concat([
				`has cards: ${this.renderCards(analyzer.has)}`,
				`does not have cards: ${this.renderCards(analyzer.hasNot)}`,
				`has unknown cards in: ${this.renderList(Array.from(analyzer.hasSet))}`,
			]);
		}
		msg.channel.send(`It is known that ${msg.author}:` + data.map(l => `\n - ${l}`).join(""));
	}
}

class FishBot extends require("discord.js").Client {
	prefix = "f.";

	constructor() {
		super();
		this.on("ready", this.setup);
		this.on("message", this.onMessage);
		this.commands = new FishBotCommands(this);
		this.parser = new FishBotParser(this);
		this.games = {};
	}

	setup() {
		console.log(`Logged in as ${this.user.tag}!`);
	}
	
	onMessage(msg) {
		const cleaned = this.checkPrefix(msg);
		if(!cleaned) return;
		const tokens = cleaned.split(/\s+/);
		const command = tokens.shift();
		this.commands.process(msg, command, tokens);
	}

	gameFor(msg) {
		return this.games[msg.channel.id] || null;
	}
}

const bot = new FishBot();
bot.login(process.env.TOKEN);
