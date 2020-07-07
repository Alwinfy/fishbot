"use strict";

const {FishSuit, FishGame, FishGameBuilder} = require('./fish');
const {Suit, Rank, Card} = require('./card');

const toss = err => {throw err};

const FISH_SIDES = ["Trivial", "Obvious"];
const FISH_CHARS = "BEFGIMNOPRTUVWXYZ";

class Parser {
	static checkPrefix(msg) {
		const trimmed = msg.content.replace(/^\s+/, '');
		return trimmed.startsWith(this.prefix)
			? trimmed.substring(0, this.prefix.length) : null;
	}

	static parseRank(str) {
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

	static parseSuit(str) {
		for (const suit of Suit.ALL)
			if (suit.character === str[0] || suit.name[0].toLowerCase() === str[0])
				return suit;
		return null;
	}

	static parseFishSuit(str, game) {
		const FISH_SUIT_RE = /\b(l(?:ow)?\|h(?:i(?:gh)?)?)\s*([\u2660-\u2663hscd])\|(\bjo)/i;
		const match = FISH_SUIT_RE.match(str.toLowerCase());
		if (!match) return null;
		let fsuit = null;
		if (match[3]) {
			fsuit = FishSuits.ALL[0];
		}
		else {
			const rank = match[1][0] == 'l' ? Rank.TWO : Rank.ACE;
			const suit = parseSuit(match[2]);
			fsuit = FishSuit.suitFor(Card.cardFor(suit, rank));
		}
		return fsuit;
	}

	static parseCards(str, game) {
		const CARD_RE = /\b((?:10|[1-79jqka])|[a-z]+\s*o[f']?\s*)([\u2660-\u2663hscd])|\b([rb][a-z]*\s*j)/i;
		const hits = [];
		for (const match of CARD_RE.matchAll(str.toLowerCase())) {
			if (match[3] && game && game.cfg.get("jokers")) {
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

	static parsePlayer(str, game) {
		const MENTION_RE = /<@!?(\d\+)>/;
		const match = MENTION_RE.match(str);
		return game.playerFor(str) || (match && game.playerFor(match[1])) || parsePlayerChar(str, game);
	}

	static parsePlayerChar(str, game) {
		for (const player of game.players)
			if (str.toUpperCase() === player.character)
				return player;
		return null;
	}

	static parsePlayerString(str, player) {
		const players = [];
		for (const chr of str) {
			const player = (chr === '@' ? player : this.parsePlayerChar(chr, player.game));
			if (!player)
				return null;
			players.push(player);
		}
		return players;
	}

	static parseSide(str) {
		for (let i = 0; i < FISH_SIDES.length; i++)
			if (FISH_SIDES[i].toLowerCase().startsWith(str.toLowerCase()))
				return i;
		return -1;
	}
}

function charPlugin() {
	let i = 0;
	class FishPlayerCharPlugin {
		static pluginName = "char";
		constructor(player) {
			player.character = FISH_CHARS[i++];
			player.attemptedCancel = false;
		}
	}
	return FishPlayerCharPlugin;
}

function playerEventPlugin(mainchan, usermap) {
	class FishPlayerDiscordPlugin {
		static pluginName = "playerEvent";

		constructor(player) {
			this.message = null;
			usermap(player).createDM().then(dm => setup(player, dm));
			player.on("handChange", this.onHandChange.bind(this));
			player.on("turnStart", () => setTimeout(() => mainchan.send(`It is now <@${player.id}>'s turn.`)));
		}

		handMessage(hand) {
			return `Your current hand: ${bot.commands.renderCards(this.hand)}`;
		}

		setup(player, dm) {
			return dm.send(this.handMessage(player)).then(message => this.message = message);
		}

		onHandChange(newHand) {
			this.message.edit(this.handMessage(newHand));
		}
	}
	return FishBotDiscordPlugin;
}

class FishBotCommands {
	static CODE_PREFIX = "cmd_";

	static COMMANDS = {
		"help": "`void *ptr = &ptr;`",
		"ping": "Check if bot is online",
		"join": "Join the game in the current channel",
		"leave": "Leave the game in the current channel",
		"options": "List all options",
		"enable": "Enable options",
		"disable": "Disable options",
		"start": "Begin a game",

		"info": "Get info about the current game",
		"abort": "Vote to cancel a running game",
		"deck": "Get info about the game deck",
		"common": "Get common knowledge about a player",
		"request": "Request a card",
		"declare": "Declare a half-suit",
		"selfdeclare": "Declare a half-suit held by one person",
		"pass": "Pass your turn to someone else",
		"liquidate": "Declare Liquidation for your team",
		"poke": "Ping whoever's turn it is",

		"eval": null,
	};
	static ALIASES = {
		"join": ["in"],
		"leave": ["out"],
		"cancel": ["end"],
		"common": ["ck"]
	};

	static ERR_NO_GAME     = Symbol("No game is happening in this channel-- create one!");
	static ERR_NOT_STARTED = Symbol("The game hasn't started yet!");
	static ERR_STARTED     = Symbol("The game's already begun!");
	static ERR_NO_PLAYER   = Symbol("You aren't playing in this game!");

	constructor(bot) {
		this.bot = bot;
		this.docstrings = [];
		this.commands = {};
		for (const cmd in FishBotCommands.COMMANDS) {
			const func = this[FishBotCommands.CODE_PREFIX + cmd] || toss(new Error(`No function in ${this} called ${cmd}!`));
			this.commands[cmd] = func.bind(this);
			if (cmd in FishBotCommands.ALIASES)
				for (const alias of FishBotCommands.ALIASES[cmd])
					this.commands[alias] = this.commands[cmd];
			if (FishBotCommands.COMMANDS[cmd]) {
				let snipsize;
				for (snipsize = 1; snipsize < cmd.length; snipsize++) {
					const snip = cmd.substring(0, snipsize);
					if (!(snip in this.commands)) {
						this.commands[snip] = this.commands[cmd];
						break;
					}
				}
				let docstring = `**${snipsize === cmd.length ? cmd : `__${cmd.substring(0, snipsize)}__${cmd.substring(snipsize)}`}** - ${FishBotCommands.COMMANDS[cmd]}`;
				if (cmd in FishBotCommands.ALIASES)
					docstring += ` (aliases: ${FishBotCommands.ALIASES[cmd].join(", ")})`;
				this.docstrings.push(docstring);
			}
		}
	}

	
	gameFor(msg) {
		return this.bot.gameFor(msg) || toss(FishBotCommands.ERR_NO_GAME);
	}

	activePlayerFor(msg) {
		const game = this.gameFor(msg);
		if (!game.started)
			throw FishBotCommands.ERR_NOT_STARTED;
		return game.getPlayer(msg.author.id) || toss(FishBotCommands.ERR_NO_PLAYER);
	}

	gameBuilderFor(msg) {
		const game = this.gameFor(msg);
		if (game.started)
			throw FishBotCommands.ERR_STARTED;
		return game;
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

	renderTeam(team) {
		return FISH_TEAMS[team.ordinal];
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

	pokeInfo(game) {
		if (!game.started)
			return `This game has not yet started.`;
		if (game.currentPlayer)
			return `It is currently ${this.renderPlayer(game.currentPlayer)}'s turn to ask a question.`;
		return `**The game is in Liquidation! No more questions are possible.**`;
	}

	// Commands
	cmd_help(msg) {
		msg.channel.send(`**FishBot v${this.bot.version}**\n__*Command list:*__\n${this.docstrings.map(x => this.bot.prefix + x).join('\n')}\n*Underlined sections of commands are shorthands.*`);
	}

	cmd_ping(msg) {
		msg.channel.send("pong");
	}

	cmd_options(msg) {
		const config = this.gameBuilderFor(msg).config;
		const strings = [];
		for (const key of config)
			strings.push(`\n${key} (currently ${config.get(key) ? "enabled" : "disabled"}): **${config.nameFor(key)}** - ${config.descriptionFor(key)}`);
		msg.channel.send(`**__Current game options:__**${strings.join("")}`);
	}

	cmd_enable(msg, args) {
		const config = this.gameBuilderFor(msg).config;
		const succ = [];
		for (const arg of args) {
			if (config.has(arg)) {
				config.set(arg, true);
				succ.push(config.nameFor(arg));
			}
		}
		if (succ.length)
			msg.channel.send(`Enabled options: **${this.renderList(succ)}**`);
		else 
			msg.channel.send(`Usage: ${this.bot.prefix}enable [options to enable]`);
	}

	cmd_disable(msg, args) {
		const config = this.gameBuilderFor(msg).config;
		const succ = [];
		for (const arg of args) {
			if (config.has(arg)) {
				config.set(arg, false);
				succ.push(config.nameFor(arg));
			}
		}
		if (succ.length)
			msg.channel.send(`Disabled options: **${this.renderList(succ)}**`);
		else 
			msg.channel.send(`Usage: ${this.bot.prefix}disable [options to enable]`);
	}

	cmd_join(msg, args) {
		const game = this.bot.gameFor(msg);
		if (game) {
			if (game.started)
				return msg.channel.send("Too late to join, game has already started.");
			if (!game.teamFor(msg.author.id) && game.totalPlayers() >= FishBot.MAX_PLAYERS)
				return msg.channel.send(`Too many players this game (capped at ${FishBot.MAX_PLAYERS})!`);

			const side = game.addHandle(msg.author.id, Parser.parseSide(args[0]));
			if (~side)
				msg.channel.send(`${msg.author} has joined this game of Fish.`);
			else
				msg.channel.send(`You're already on that team!`);
		} else {
			this.bot.games[msg.channel.id] = new FishGameBuilder();
			const side = game.addHandle(msg.author.id);
			msg.channel.send(`${msg.author} has created a game of Fish. Type ${this.bot.prefix}join to join.`);
		}
	}

	cmd_leave(msg) {
		const game = this.gameFor(msg);
		if (game.started)
			return msg.channel.send("Too late to leave, game has already started.");
		if (game.removeHandle(msg.author.id)) {
			if (game.totalPlayers())
				msg.channel.send(`${msg.author} has left the game.`);
			else {
				msg.channel.send(`${msg.author} has left the game, ending it behind them.`);
				delete this.bot.games[msg.channel.id];
			}
		}
		else
			msg.channel.send(`You have not joined this game!`);
	}

	cmd_start(msg) {
		const game = this.gameFor(msg);
		const players = game.totalPlayers();
		if(players < FishGame.MIN_PLAYERS)
			return msg.channel.send(`Can't start without at least ${FishGame.MIN_PLAYERS} players!`);
		game = this.bot.games[msg.channel.id] = game.build([charPlugin(), handDMPlugin(x => this.bot.users.get(x))]);
		game.voteCancels = 0;
		game.voteTarget = Math.floor(players / 2);
		game.on("gameBegin", () => {
			msg.channel.send(`The game of Fish begins!`);
		});
		game.on("gameEnd", winners => {
			if (winners.length === 1) {
				const winner = winners[0];
				msg.channel.send(`**The game is over. Team ${this.renderTeam(winner)} wins ${winner.score()} to ${winner.opponent.score()}!**`);
			}
			else
				msg.channel.send(`**The game ends in a tie!**`);
		});
		game.on("scoreSet", (suit, team) => {
			msg.channel.send(`**Team ${FISH_TEAMS[team.ordinal]} has acquired the ${suit} half-suit!**`);
		});
	}

	cmd_abort(msg) {
		const player = this.activePlayerFor(msg);
		if (player.attemptedCancel)
			return msg.channel.send(`You've already voted to abort this game.`);
		player.attemptedCancel = true;
		let message = `${msg.author} has voted to abort this game (${++game.voteCancels}/${game.voteTarget})`;
		if (game.voteCancels >= game.voteTarget) {
			message += ", so the game has been canceled";
			delete this.bot.games[msg.channel.id];
		}
		msg.channel.send(msg + ".");
	}

	cmd_common(msg, args) {
		const player = Parser.parsePlayer(args[0]) || this.activePlayerFor(msg);
		let data = [
			`has ${player.hand.size()} cards`
		];
		const analyzer = player.plugins.analyzer;
		if (analyzer) {
			data = data.concat([
				`has cards: ${this.renderCards(analyzer.has)}`,
				`does not have cards: ${this.renderCards(analyzer.hasNot)}`,
				`has unknown cards in: ${this.renderList(Array.from(analyzer.hasSuit))}`,
			]);
		}
		msg.channel.send(`It is known that ${msg.author}:` + data.map(l => `\n - ${l}`).join(""));
	}

	cmd_info(msg) {
		const game = this.gameFor(msg);
		let teamids;
		if (game.started)
			teamids = game.teams.map(t => Array.from(t.players));
		else
			teamids = game.teams.map(t => Array.from(t)); 
		const scores = game.started ? game.teams.map(t => t.score()) : [];
		const config = game.started ? game.config : game;
		const enabled = config.listing.filter(c => config.get(c)).map(c => config.nameFor(c));
		const disabled = config.listing.filter(c => !config.get(c)).map(c => config.nameFor(c));
		let info = `**Current teams:**`;
		for(let i = 0; i < teamids.length; i++) {
			info += `\n__Team ${FISH_SIDES[i]}__: ${teamids[i].map(h => this.bot.users.get(game.started ? h.handle : h).tag + game.started ? ` [${h.character}]` : "").join(", ")}`;
			if (game.started)
				info += ` (holds: ${this.renderList(Array.from(game.teams[i].ownedSets))})`;
		}
		info += `\n**Enabled settings:** ${enabled.join(", ")}`;
		info += `\n**Disabled settings:** ${disabled.join(", ")}`;
		info += `\n*${this.pokeInfo(game)}*`;
		msg.channel.send(info);
	}

	cmd_deck(msg) {
		// TODO stub
	}

	cmd_request(msg, args) {
		const player = this.activePlayerFor(msg);
		const game = player.game;
		const donor = Parser.parsePlayer(args[0], game);
		if (!donor)
			return msg.channel.send(`Usage: ${this.bot.prefix}request [donor] [card]`);
		const rest = args.slice(1).join(" ");
		const card = Parser.parseCards(rest, game)[0];
		if (!card)
			return msg.channel.send(`Can't figure out what card you mean by ${rest}!`);
		let message = `${this.renderPlayer(player)} tries to take the ${card} from ${this.renderPlayer(donor)}... `
		if (game.moveCard(donor, player, card))
			message += `**and succeeds!**`;
		else
			message += `**but fails.**`;
		msg.channel.send(message);
	}

	cmd_declare(msg, args) {
		const player = this.activePlayerFor(msg);
		const game = player.game;
		const suit = Parser.parseFishSuit(msg.content, game);
		if (!suit)
			return msg.channel.send(`Usage: ${this.bot.prefix}declare [suit] [owners]`);
		const owners = Parser.parsePlayerString(args[args.length - 1], player);
		if (!owners)
			return msg.channel.send(`Suit **${suit}** has cards in this order: ${this.renderCards(cards)}`);
		if (game.declare(player, suit, owners))
			msg.channel.send(`${this.renderPlayer(player)}'s declaration was right!`);
		else
			msg.channel.send(`${this.renderPlayer(player)}'s declaration was wrong.`);
	}

	cmd_selfdeclare(msg) {
		const player = this.activePlayerFor(msg);
		const game = player.game;
		const suit = Parser.parseFishSuit(msg.content, game);
		if (!suit)
			return msg.channel.send(`Usage: ${this.bot.prefix}declare [suit]`);
		game.declareSelf(player, suit);
		msg.channel.send(`${this.renderPlayer(player)} had all the cards of suit **${suit}**!`);
	}

	cmd_pass(msg, args) {
		const player = this.activePlayerFor(msg);
		const game = player.game;
		const target = Parser.parsePlayer(args[0], game);
		if (!target)
			return msg.channel.send(`Usage: ${this.bot.prefix}pass [receiver]`);
		game.passTurn(player, target);
		msg.channel.send(`${this.renderPlayer(player)} passes their turn to ${this.renderPlayer(target)}!`);
	}

	cmd_liquidate(msg) {
		const player = this.activePlayerFor(msg);
		player.game.liquidate(player.team);
		msg.channel.send(`${this.renderTeam(player.team)} is out of cards and claims Liquidation!`);
	}

	cmd_poke(msg) {
		msg.channel.send(`*${this.pokeInfo(this.gameFor(msg))}*`);
	}

	cmd_eval(msg, args) {
		if (msg.author !== env.FISH_AUTHOR)
			return msg.channel.send("*Nice try.*");
		msg.channel.send(eval(args.join(" ")));
	}
}

class FishBot extends require("discord.js").Client {
	static MAX_PLAYERS = FISH_CHARS.length;

	prefix = "f.";

	constructor() {
		super();
		this.on("ready", this.setup);
		this.on("message", this.onMessage);
		this.commands = new FishBotCommands(this);
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

let bot;
if(require.main === module) {
	bot = new FishBot();
	bot.login(process.env.TOKEN);
}
