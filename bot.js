"use strict";

const {FishError, FishSuit, FishGame, FishGameBuilder} = require("./fish");
const {Suit, Rank, Card} = require("./card");
const {Deck} = require("./deck");

const botAdmins = (process.env.FISH_AUTHORS || "").split(":");

const toss = err => {throw err};

const FISH_SIDES = ["Trivial", "Obvious"];
const FISH_CHARS = "BEFGIMNOPRTUVWXYZ";

const extraInfo = `\
Fish is a game for about 4-12 players, split into two teams. The object of the game is to claim "half-suits"-- sets of (usually) six cards-- for your team (use the \`$$deck\` command for more info).
When the game begins, a random person is chosen as the inquisitor. The inquisitor can ask someone on the opposing team for a card using \`$$request <player> <card>\`.
Each player is also assigned a letter-- the character in brackets as seen in \`$$info\` and the game start message. These are used when *declaring* a half-suit.
To declare a half-suit, use \`$$declare <suit name> <string of letters>\`, where each letter corresponds to the person you think holds that card.
If you have all six cards in the half-suit, you can also say \`$$selfdeclare <suit name>\`.
In general, you can specify players with pings or player-characters (e.g. "@someone#1234" or "B"); suits with their names or abbreviations (e.g. "High Spades" or "HS"), and cards with their names or abbreviations (e.g. "Queen of Hearts", "QoH", or "Q\u2661".
If you're out of cards, you can pass your turn with \`$$pass <player>\`.
If you're right, your team claims the suit; if you're wrong your opponents do.
The team that gets the most half-suits wins. Good luck.`;

class Parser {
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

	static parseFishSuit(str) {
		const FISH_SUIT_RE = /\b(l(?:ow)?|h(?:i(?:gh)?)?)\s*([\u2660-\u2667hscd])|(\bjo)/i;
		const match = str.toLowerCase().match(FISH_SUIT_RE);
		if (!match) return null;
		let fsuit = null;
		if (match[3]) {
			fsuit = FishSuit.ALL[0];
		}
		else {
			const rank = match[1][0] === 'l' ? Rank.TWO : Rank.ACE;
			const suit = Parser.parseSuit(match[2]);
			fsuit = FishSuit.suitFor(Card.cardFor(suit, rank));
		}
		return fsuit;
	}

	static parseCards(str, game) {
		const CARD_RE = /\b((?:10|[1-9jqka])|[a-z]+\s*o[f']?\s*)(?:\s*o[f']?\s*)?([\u2660-\u2667hsd]|c(?=[^e]|$))|\b([rb][a-z]*\s*j)/ig;
		const hits = [];
		for (const match of str.toLowerCase().matchAll(CARD_RE)) {
			if (match[3] && game && game.config.get("jokers")) {
				hits.push(Card.cardFor(match[3][0] === "r" ? Suit.HEARTS : Suit.SPADES, Rank.JOKER));
				continue;
			}
			const rank = Parser.parseRank(match[1]);
			const suit = Parser.parseSuit(match[2]);
			if (rank && suit)
				hits.push(Card.cardFor(suit, rank));
		}
		return hits;
	}

	static parsePlayer(str, game) {
		const MENTION_RE = /[^a-z0-9]*([a-z]|\d+)[^a-z0-9]*/i;
		const match = str.match(MENTION_RE);
		if (!match) return null;
		return game.playerFor(match[1]) || Parser.parsePlayerChar(match[1], game);
	}

	static parsePlayerChar(str, game) {
		for (const player of game.players)
			if (str.toUpperCase() === player.character)
				return player;
		return null;
	}

	static parsePlayerString(str, op) {
		const players = [];
		for (const chr of str) {
			const player = (chr === '@' ? op : Parser.parsePlayerChar(chr, op.game));
			if (!player)
				return null;
			players.push(player);
		}
		return players;
	}

	static parseSide(str) {
		if (!str.trim().length) return -1;
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

function playerEventPlugin(cmds, mainchan, usermap) {
	class FishPlayerDiscordPlugin {
		static pluginName = "playerEvent";

		constructor(player) {
			this.message = null;
			usermap(player.handle).createDM().then(dm => this.setup(player, dm));
			player.on("handChange", this.onHandChange.bind(this));
			player.on("turnStart", () => setTimeout(() => mainchan.send(`It is now ${cmds.renderPlayer(player)}'s turn.`)));
		}

		handMessage(hand) {
			return `Your current hand: ${cmds.renderCards(hand)}`;
		}

		setup(player, dm) {
			return dm.send(this.handMessage(player.hand)).then(message => this.message = message);
		}

		onHandChange(newHand) {
			this.message.edit(this.handMessage(newHand));
		}
	}
	return FishPlayerDiscordPlugin;
}

class FishBotCommands {
	static CODE_PREFIX = "cmd_";

	static COMMANDS = {
		"_general": "Bot Health",
		"help": "`void *ptr = &ptr;`",
		"ping": "Check if bot is online",
		"usage": "Get info about the game this bot plays",

		"_gameplay": "Gameplay",
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
		"roll": "Roll dice (e.g. 3d6+2)",

		"_game": "Game Creation",
		"start": "Begin a game",
		"join": "Join or create a game or team",
		"leave": "Leave a game",
		"options": "List all game options",
		"enable": "Enable game options",
		"disable": "Disable game options",

		"eval": null,
		"you": null,
		"off": null,
		"ish": null,
	};
	static ALIASES = {
		"join": ["in", "enter"],
		"leave": ["out", "exit"],
		"start": ["begin"],
		"abort": ["end", "quit", "stop", "cancel"],
		"common": ["ck"],
		"request": ["get", "ask", "snatch", "grab", "yoink"],
		"declare": ["claim", "yeet"],
		"selfdeclare": ["sd"],
		"help": ["?"],
		"options": ["opts"],
		"enable": ["set"],
		"disable": ["unset"],
	};

	static ERR_NO_GAME     = new FishError("No game is happening in this channel-- create one with `join`!");
	static ERR_NOT_STARTED = new FishError("The game hasn't started yet.");
	static ERR_STARTED     = new FishError("The game's already started.");
	static ERR_NO_PLAYER   = new FishError("You aren't playing in this game.");

	constructor(bot) {
		this.bot = bot;
		this.docstrings = [];
		this.commands = {};
		for (const cmd in FishBotCommands.COMMANDS) {
			if (cmd.startsWith("_")) {
				this.docstrings.push(`\n__${FishBotCommands.COMMANDS[cmd]}:__`);
				continue;
			}
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
		return game.playerFor(msg.author.id) || toss(FishBotCommands.ERR_NO_PLAYER);
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
			console.log(cmd, args);
			this.commands[cmd](msg, args);
		} catch (e) {
			if (e instanceof FishError)
				msg.channel.send(`Error: ${e.toString()}`);
			else
				throw e;
		}
	}

	renderTeam(team) {
		return FISH_SIDES[team.ordinal];
	}

	teamInfo(game) {
		const teamids = game.teams.map(t => Array.from(t.players));
		let info = `**Teams:**`;
		for(let i = 0; i < teamids.length; i++) {
			info += `\n\n__Team ${FISH_SIDES[i]}__: ${teamids[i].map(h => this.bot.users.get(h.handle).tag + ` [**${h.character}**]`).join(", ") || "Nobody"}`;
		}
		return info;
	}

	renderSuits(suitSet) {
		const lines = [];
		for(const suit of suitSet)
			lines.push(`**${suit}**, ${suit.cards.length} cards: ${this.renderCards(suit.cards)}`);
		return lines.join("\n") || "None";
	}

	renderCards(cardset) {
		const list = Deck.sortCards(Array.from(cardset));
		if (list.length < 5)
			return this.renderList(list);
		return list.map(c => c.toAbbr()).join(" ");
	}

	renderList(list, word = "and") {
		switch (list.length) {
		case 0: return "None";
		case 1: return list[0].toString();
		case 2: return `${list[0]} ${word} ${list[1]}`;
		}
		const last = list.pop();
		return `${list.join(", ")}, ${word} ${last}`;
	}

	renderPlayer(plr) {
		return `<@${plr.handle}>`;
	}

	optsInfo(game) {
		const config = game.started ? game.config : game;
		const enabled = config.getListing().filter(c => config.get(c)).map(c => config.nameFor(c));
		const disabled = config.getListing().filter(c => !config.get(c)).map(c => config.nameFor(c));
		return `**Enabled settings:** ${enabled.join(", ") || "None"}`
			+ `\n**Disabled settings:** ${disabled.join(", ") || "None"}`;
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
		msg.author.send(`**FishBot v${this.bot.version}**\n__*Command list:*__\n${this.docstrings.map(x => x.startsWith('\n') ? x : this.bot.prefix + x).join('\n')}\n*Underlined sections of commands are shorthands.*`);
	}

	cmd_ping(msg) {
		msg.channel.send("pong");
	}

	cmd_usage(msg) {
		msg.author.send(extraInfo.replace(/\$\$/g, this.bot.prefix) + `\n\n**Questions? Concerns? Bot broke?** Contact ${this.renderList(botAdmins.map(a => `<@${a}>`), "or")}.`);
	}

	cmd_options(msg) {
		const config = this.gameBuilderFor(msg);
		const strings = [];
		for (const key of config.getListing())
			strings.push(`\n${key} (${config.get(key) ? "**enabled**" : "*disabled*"}): **${config.nameFor(key)}** - ${config.descriptionFor(key)}`);
		msg.channel.send(`**__Current game options:__**${strings.join("")}\n\n${this.optsInfo(config)}`);
	}

	cmd_enable(msg, args) {
		const config = this.gameBuilderFor(msg);
		const succ = [];
		for (const arg of args) {
			const find = config.getListing().filter(l => l.startsWith(arg));
			if (find) {
				config.set(find[0], true);
				if (!~succ.indexOf(find[0]))
					succ.push(config.nameFor(find[0]));
			}
		}
		if (succ.length)
			msg.channel.send(`Enabled options: **${succ.join(", ")}**`);
		else 
			msg.channel.send(`Usage: ${this.bot.prefix}enable [options to enable]`);
	}

	cmd_disable(msg, args) {
		const config = this.gameBuilderFor(msg);
		const succ = [];
		for (const arg of args) {
			const find = config.getListing().filter(l => l.startsWith(arg));
			if (find) {
				config.set(find[0], false);
				if (!~succ.indexOf(find[0]))
					succ.push(config.nameFor(find[0]));
			}
		}
		if (succ.length)
			msg.channel.send(`Disabled options: **${succ.join(", ")}**`);
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

			const side = game.addHandle(msg.author.id, Parser.parseSide(args[0] || ""));
			if (~side)
				msg.channel.send(`${msg.author} has joined the ${FISH_SIDES[side]} team for this game of Fish.`);
			else
				msg.channel.send(`You're already on that team!`);
		} else {
			const newGame = this.bot.games[msg.channel.id] = new FishGameBuilder();
			const side = newGame.addHandle(msg.author.id, Parser.parseSide(args[0] || ""));
			msg.channel.send(`${msg.author} has created a game of Fish (and joined as ${FISH_SIDES[side]}). Type ${this.bot.prefix}join to join.`);
		}
	}

	cmd_leave(msg) {
		const game = this.gameBuilderFor(msg);
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
		let game = this.gameBuilderFor(msg);
		const players = game.totalPlayers();
		if (players < FishGame.MIN_PLAYERS)
			return msg.channel.send(`Can't start without at least ${FishGame.MIN_PLAYERS} players!`);
		if (Math.abs(game.teams[0].size - game.teams[1].size) >= 2)
			return msg.channel.send(`Can't start, teams too imbalanced!`);
		game = this.bot.games[msg.channel.id] = game.build([charPlugin(), playerEventPlugin(this, msg.channel, x => this.bot.users.get(x))]);
		game.voteCancels = 0;
		game.voteTarget = Math.ceil(players / 2);
		game.on("gameBegin", () => {
			msg.channel.send(`The game of Fish begins!\n` + this.teamInfo(game));
		});
		game.on("gameEnd", winners => {
			if (winners.length === 1) {
				const winner = winners[0];
				msg.channel.send(`**The game is over. Team ${this.renderTeam(winner)} wins ${winner.score()}-${winner.opponent.score()}!**`);
			}
			else
				msg.channel.send(`**The game ends in a tie!**`);
			delete this.bot.games[msg.channel.id];
		});
		game.on("scoreSet", (suit, team) => {
			msg.channel.send(`**Team ${FISH_SIDES[team.ordinal]} has acquired the ${suit} half-suit!**`);
		});
	}

	cmd_abort(msg) {
		const player = this.activePlayerFor(msg);
		const game = player.game;
		if (player.attemptedCancel)
			return msg.channel.send(`You've already voted to abort this game.`);
		player.attemptedCancel = true;
		let message = `${msg.author} has voted to abort this game (${++game.voteCancels}/${game.voteTarget})`;
		if (game.voteCancels >= game.voteTarget) {
			message += ", so the game has been canceled";
			delete this.bot.games[msg.channel.id];
		}
		msg.channel.send(message + ".");
	}

	cmd_common(msg, args) {
		const me = this.activePlayerFor(msg);
		const player = Parser.parsePlayer(args[0] || "", me.game) || me;
		let data = [
			`has ${player.hand.size} cards`
		];
		const analyzer = player.plugins.analyzer;
		if (analyzer) {
			data = data.concat([
				`has cards: ${this.renderCards(analyzer.has)}`,
				`does not have cards: ${this.renderCards(analyzer.hasNot)}`,
				`has unknown cards in: ${this.renderList(Array.from(analyzer.hasSuit))}`,
			]);
		}
		msg.channel.send(`It is known that ${this.renderPlayer(player)}:` + data.map(l => `\n - ${l}`).join(""));
	}

	cmd_info(msg) {
		const game = this.gameFor(msg);
		const teamids = game.teams.map(t => Array.from(game.started ? t.players : t));
		let info = `**Current teams:**`;
		for(let i = 0; i < teamids.length; i++) {
			info += `\n__Team ${FISH_SIDES[i]}__: ${teamids[i].map(h => this.bot.users.get(game.started ? h.handle : h).tag + (game.started ? ` [**${h.character}**]` : "")).join(", ") || "Nobody"}`;
			if (game.started)
				info += `\n - Score: **${game.teams[i].score()}** (${this.renderList(Array.from(game.teams[i].ownedSuits))})`;
		}
		info += `\n${this.optsInfo(game)}`;
		info += `\n*${this.pokeInfo(game)}*`;
		msg.channel.send(info);
	}

	cmd_deck(msg) {
		const game = this.activePlayerFor(msg).game;
		let deck = `**__Unclaimed half-suits:__**\n${this.renderSuits(game.remainingSuits)}`;
		for (const team of game.teams)
			deck += `\n**__Suits claimed by team ${this.renderTeam(team)}:__**\n${this.renderSuits(team.ownedSuits)}`;
		msg.channel.send(deck);
	}

	cmd_request(msg, args) {
		const player = this.activePlayerFor(msg);
		const game = player.game;
		const donor = Parser.parsePlayer(args[0] || "", game);
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
			message += `*but fails.*`;
		const mp = msg.channel.send(message);
		if (!game.config.get("bookkeeping"))
			mp.then(m => m.delete(10000));
	}

	cmd_declare(msg, args) {
		const player = this.activePlayerFor(msg);
		const game = player.game;
		const suit = Parser.parseFishSuit(msg.content);
		if (!suit)
			return msg.channel.send(`Usage: ${this.bot.prefix}declare [suit] [owners]`);
		const owners = Parser.parsePlayerString(args[args.length - 1], player);
		if (!owners)
			return msg.channel.send(`Suit **${suit}** has cards in this order: ${this.renderCards(suit.cards)}`);
		if (game.declare(player, suit, owners))
			msg.channel.send(`${this.renderPlayer(player)}'s declaration was right!`);
		else
			msg.channel.send(`${this.renderPlayer(player)}'s declaration was wrong.`);
	}

	cmd_selfdeclare(msg) {
		const player = this.activePlayerFor(msg);
		const game = player.game;
		const suit = Parser.parseFishSuit(msg.content);
		if (!suit)
			return msg.channel.send(`Usage: ${this.bot.prefix}selfdeclare [suit]`);
		game.declareSelf(player, suit);
		msg.channel.send(`${this.renderPlayer(player)} had all the cards of suit **${suit}**!`);
	}

	cmd_pass(msg, args) {
		const player = this.activePlayerFor(msg);
		const game = player.game;
		const target = Parser.parsePlayer(args[0] || "", game);
		if (!target)
			return msg.channel.send(`Usage: ${this.bot.prefix}pass [receiver]`);
		game.passTurn(player, target);
		msg.channel.send(`${this.renderPlayer(player)} passes their turn to ${this.renderPlayer(target)}.`);
	}

	cmd_liquidate(msg) {
		const player = this.activePlayerFor(msg);
		player.game.liquidate(player.team);
		msg.channel.send(`**Team ${this.renderTeam(player.team)} is out of cards and claims Liquidation!**`);
	}

	cmd_poke(msg) {
		msg.channel.send(`*${this.pokeInfo(this.gameFor(msg))}*`);
	}

	cmd_roll(msg, args) {
		const MAXINFO = 40, MAXDICE = 10000, MAXROLL = 1e6;

		if (!args.length)
			return msg.channel.send(`Usage: ${this.bot.prefix}roll 3d6+2`);
		const str = args.join("");
		const split = str.split(/\+|(?=-)/);
		const kept = [], dropped = [];
		let count = 0, total = 0, math = 0;

		for(const roll of split) {
			if(!roll) continue;
			// parse
			const match = roll.match(/^(-?)([0-9]*)(?:d([0-9]+))?([ukld])?([0-9]*)(!?)$/i);
			if(!match)
				return msg.channel.send(`Got a bad diceroll: ${roll}!`);
			// parse & check conditions
			const mul = match[1] ? -1 : 1;
			const rolls = match[2] ? +match[2] : 1;
			if(!rolls) continue;
			count += rolls;
			if(count > MAXDICE)
				return msg.channel.send(`That's too many dice!`);
			if(!match[3]) {
				total += mul * rolls;
				math += mul * rolls;
				continue;
			}
			const sides = +match[3];
			if(sides < 2 || sides > MAXROLL)
				return msg.channel.send(`This bot has no ${sides}-sided dice.`);
			let keep = match[4] ? Math.min(rolls, Math.max(0, match[5] ? +match[5] : rolls - 1)) : rolls;
			if(match[4] === 'd')
				keep = rolls - keep;
			// do the rolls
			const therolls = new Array(rolls), thekeep = new Array(keep), thedrop = new Array(rolls - keep);
			for(let i=0; i<rolls; i++)
				therolls[i] = [i, 1 + Math.floor(Math.random() * sides)];
			therolls.sort(match[4] === 'l' ? ((a, b) => a[1] - b[1]) : ((a, b) => b[1] - a[1]));
			for(let i=0; i<keep; i++) {
				thekeep[i] = therolls[i];
				total += thekeep[i][1] * mul;
			}
			for(let i=keep; i<rolls; i++)
				thedrop[i - keep] = therolls[i];
			if(!match[6]) {
				thekeep.sort((a, b) => a[0] - b[0]);
				thedrop.sort((a, b) => a[0] - b[0]);
			}
			else {
				thekeep.sort((a, b) => a[1] - b[1]);
				thedrop.sort((a, b) => a[1] - b[1]);
			}
			kept.push([mul, thekeep]);
			if(thedrop.length)
				dropped.push(thedrop);
		}
		let message = `You roll \`${str}\` and get **${total}**.`;
		if((kept.length || dropped.length) && count <= MAXINFO) {
			message += ' ';
			if(kept.length >= 2 || kept[0][1].length >= 2 || dropped.length) {
				message += `${kept[0][0] === -1 ? '-' : ""}[ ${kept[0][1].map(x => x[1]).join(", ")} ]`;
				for(let i=1; i<kept.length; i++)
					message += ` ${kept[i][0] === -1 ? '-' : '+'} [ ${kept[i][1].map(x => x[1]).join(", ")} ]`;
				if(math) message += ` ${math > 0 ? '+' : '-'} ${Math.abs(math)}`;
			}
			if(dropped.length) {
				message += `, dropped [ ${dropped[0].map(x => x[1]).join(", ")} ]`;
				for(let i=1; i<dropped.length; i++)
					message += `& [ ${dropped[i].map(x => x[1]).join(", ")} ]`;
			}
		}
		msg.channel.send(message);
	}

	cmd_eval(msg, args) {
		if (!~botAdmins.indexOf(msg.author.id))
			return msg.channel.send("*Nice try.*");
		let res;
		try {
			res = eval(`msg => ${args.join(" ")}`)(msg);
		} catch(e) {
			res = e;
		}
		msg.channel.send("```\n" + res + "```");
	}

	cmd_you(msg) { msg.channel.send("no u"); }
	cmd_off(msg) { msg.channel.send("okay :("); }
	cmd_ish(msg) { msg.channel.send(">\xab(((\xb0>"); }
}

class FishBot extends require("discord.js").Client {
	static MAX_PLAYERS = FISH_CHARS.length;

	prefix = "f.";

	version = "0.1.0-alpha";

	checkPrefix(msg) {
		const trimmed = msg.content.replace(/^\s+/, "");
		return trimmed.startsWith(this.prefix)
			? trimmed.substring(this.prefix.length) : null;
	}

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
	bot.login(process.env.TOKEN.trim());
}
