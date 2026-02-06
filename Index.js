// index.js - Main Discord Bot File
const { Client, GatewayIntentBits, Collection, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
  ]
});

const PREFIX = '!';
client.commands = new Collection();

// Anti-nuke settings storage (use database in production)
const antiNukeSettings = new Map();
const warnings = new Map();
const ticketSettings = new Map();

client.once('ready', () => {
  console.log('Bot is online: ' + client.user.tag);
  client.user.setActivity('!help | Protecting servers', { type: 'WATCHING' });
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;
  
  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // ==================== MODERATION ====================
  
  if (command === 'ban') {
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) 
      return message.reply('You need Ban Members permission.');
    const user = message.mentions.members.first() || await message.guild.members.fetch(args[0]).catch(() => null);
    if (!user) return message.reply('Please mention a user to ban.');
    const reason = args.slice(1).join(' ') || 'No reason provided';
    await user.ban({ reason });
    message.reply('Banned ' + user.user.tag + ' | Reason: ' + reason);
  }

  if (command === 'kick') {
    if (!message.member.permissions.has(PermissionFlagsBits.KickMembers))
      return message.reply('You need Kick Members permission.');
    const user = message.mentions.members.first();
    if (!user) return message.reply('Please mention a user to kick.');
    const reason = args.slice(1).join(' ') || 'No reason provided';
    await user.kick(reason);
    message.reply('Kicked ' + user.user.tag + ' | Reason: ' + reason);
  }

  if (command === 'mute' || command === 'timeout') {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers))
      return message.reply('You need Moderate Members permission.');
    const user = message.mentions.members.first();
    if (!user) return message.reply('Please mention a user.');
    const duration = parseInt(args[1]) || 10;
    await user.timeout(duration * 60 * 1000, args.slice(2).join(' ') || 'No reason');
    message.reply('Muted ' + user.user.tag + ' for ' + duration + ' minutes.');
  }

  if (command === 'unmute') {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers))
      return message.reply('You need Moderate Members permission.');
    const user = message.mentions.members.first();
    if (!user) return message.reply('Please mention a user.');
    await user.timeout(null);
    message.reply('Unmuted ' + user.user.tag);
  }

  if (command === 'warn') {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers))
      return message.reply('You need Moderate Members permission.');
    const user = message.mentions.users.first();
    if (!user) return message.reply('Please mention a user.');
    const reason = args.slice(1).join(' ') || 'No reason provided';
    const key = message.guild.id + '-' + user.id;
    const userWarnings = warnings.get(key) || [];
    userWarnings.push({ reason, date: new Date(), by: message.author.id });
    warnings.set(key, userWarnings);
    message.reply('Warned ' + user.tag + ' | Total warnings: ' + userWarnings.length);
  }

  if (command === 'warnings') {
    const user = message.mentions.users.first() || message.author;
    const key = message.guild.id + '-' + user.id;
    const userWarnings = warnings.get(key) || [];
    if (userWarnings.length === 0) return message.reply(user.tag + ' has no warnings.');
    const embed = new EmbedBuilder()
      .setTitle('Warnings for ' + user.tag)
      .setDescription(userWarnings.map((w, i) => (i + 1) + '. ' + w.reason).join('\n'))
      .setColor('#ff9900');
    message.reply({ embeds: [embed] });
  }

  if (command === 'clearwarns') {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers))
      return message.reply('You need Moderate Members permission.');
    const user = message.mentions.users.first();
    if (!user) return message.reply('Please mention a user.');
    warnings.delete(message.guild.id + '-' + user.id);
    message.reply('Cleared all warnings for ' + user.tag);
  }

  if (command === 'purge' || command === 'clear') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages))
      return message.reply('You need Manage Messages permission.');
    const amount = parseInt(args[0]);
    if (!amount || amount < 1 || amount > 100)
      return message.reply('Please provide a number between 1-100.');
    await message.channel.bulkDelete(amount + 1, true);
    const msg = await message.channel.send('Deleted ' + amount + ' messages.');
    setTimeout(() => msg.delete(), 3000);
  }

  if (command === 'lock') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels))
      return message.reply('You need Manage Channels permission.');
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
    message.reply('Channel locked.');
  }

  if (command === 'unlock') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels))
      return message.reply('You need Manage Channels permission.');
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: true });
    message.reply('Channel unlocked.');
  }

  // ==================== ANTI-NUKE ====================

  if (command === 'antinuke') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator))
      return message.reply('You need Administrator permission.');
    
    const subCommand = args[0]?.toLowerCase();
    const settings = antiNukeSettings.get(message.guild.id) || { enabled: false, whitelist: [], punishment: 'ban' };

    if (!subCommand || subCommand === 'status') {
      const embed = new EmbedBuilder()
        .setTitle('Anti-Nuke Settings')
        .addFields(
          { name: 'Status', value: settings.enabled ? 'Enabled' : 'Disabled', inline: true },
          { name: 'Punishment', value: settings.punishment, inline: true },
          { name: 'Whitelisted', value: settings.whitelist.length.toString(), inline: true }
        )
        .setColor(settings.enabled ? '#00ff00' : '#ff0000');
      return message.reply({ embeds: [embed] });
    }

    if (subCommand === 'enable') {
      settings.enabled = true;
      antiNukeSettings.set(message.guild.id, settings);
      message.reply('Anti-nuke protection enabled!');
    }

    if (subCommand === 'disable') {
      settings.enabled = false;
      antiNukeSettings.set(message.guild.id, settings);
      message.reply('Anti-nuke protection disabled.');
    }

    if (subCommand === 'whitelist') {
      const user = message.mentions.users.first();
      if (!user) return message.reply('Please mention a user.');
      if (!settings.whitelist.includes(user.id)) {
        settings.whitelist.push(user.id);
        antiNukeSettings.set(message.guild.id, settings);
        message.reply('Added ' + user.tag + ' to whitelist.');
      }
    }

    if (subCommand === 'punishment') {
      const type = args[1]?.toLowerCase();
      if (!['ban', 'kick', 'strip'].includes(type))
        return message.reply('Valid punishments: ban, kick, strip');
      settings.punishment = type;
      antiNukeSettings.set(message.guild.id, settings);
      message.reply('Punishment set to: ' + type);
    }
  }

  // ==================== TICKETS ====================

  if (command === 'ticket') {
    const subCommand = args[0]?.toLowerCase();

    if (subCommand === 'setup' || subCommand === 'panel') {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild))
        return message.reply('You need Manage Server permission.');
      
      const embed = new EmbedBuilder()
        .setTitle('Support Tickets')
        .setDescription('Click the button below to create a support ticket.')
        .setColor('#5865F2');
      
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('create_ticket')
          .setLabel('Create Ticket')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🎫')
      );
      
      message.channel.send({ embeds: [embed], components: [row] });
    }

    if (subCommand === 'close') {
      if (!message.channel.name.startsWith('ticket-'))
        return message.reply('This is not a ticket channel.');
      await message.channel.delete();
    }

    if (subCommand === 'add') {
      const user = message.mentions.members.first();
      if (!user) return message.reply('Please mention a user.');
      await message.channel.permissionOverwrites.edit(user, { ViewChannel: true, SendMessages: true });
      message.reply('Added ' + user.user.tag + ' to ticket.');
    }

    if (subCommand === 'remove') {
      const user = message.mentions.members.first();
      if (!user) return message.reply('Please mention a user.');
      await message.channel.permissionOverwrites.edit(user, { ViewChannel: false });
      message.reply('Removed ' + user.user.tag + ' from ticket.');
    }
  }

  // ==================== EMOJI ====================

  if (command === 'steal' || command === 'stealemoji') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageEmojisAndStickers))
      return message.reply('You need Manage Emojis permission.');
    const emoji = args[0];
    if (!emoji) return message.reply('Please provide an emoji.');
    const emojiMatch = emoji.match(/<?(a)?:(\w+):(\d+)>?/);
    if (!emojiMatch) return message.reply('Invalid emoji format.');
    const [, animated, name, id] = emojiMatch;
    const url = 'https://cdn.discordapp.com/emojis/' + id + '.' + (animated ? 'gif' : 'png');
    const newEmoji = await message.guild.emojis.create({ attachment: url, name });
    message.reply('Added emoji: ' + newEmoji);
  }

  if (command === 'emojis') {
    const emojis = message.guild.emojis.cache;
    const embed = new EmbedBuilder()
      .setTitle('Emojis in ' + message.guild.name)
      .setDescription(emojis.map(e => e.toString()).join(' ') || 'No custom emojis')
      .setColor('#5865F2');
    message.reply({ embeds: [embed] });
  }

  // ==================== INFO ====================

  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('NexusBot Commands')
      .setDescription('Prefix: !')
      .addFields(
        { name: 'Moderation', value: 'ban, kick, mute, unmute, warn, warnings, clearwarns, purge, lock, unlock' },
        { name: 'Anti-Nuke', value: 'antinuke [enable/disable/whitelist/punishment]' },
        { name: 'Tickets', value: 'ticket [setup/close/add/remove]' },
        { name: 'Emoji', value: 'steal, emojis' },
        { name: 'Utility', value: 'serverinfo, userinfo, avatar, ping' },
        { name: 'Fun', value: '8ball, coinflip, dice' }
      )
      .setColor('#5865F2');
    message.reply({ embeds: [embed] });
  }

  if (command === 'serverinfo') {
    const guild = message.guild;
    const embed = new EmbedBuilder()
      .setTitle(guild.name)
      .setThumbnail(guild.iconURL())
      .addFields(
        { name: 'Owner', value: '<@' + guild.ownerId + '>', inline: true },
        { name: 'Members', value: guild.memberCount.toString(), inline: true },
        { name: 'Channels', value: guild.channels.cache.size.toString(), inline: true },
        { name: 'Roles', value: guild.roles.cache.size.toString(), inline: true }
      )
      .setColor('#5865F2');
    message.reply({ embeds: [embed] });
  }

  if (command === 'userinfo') {
    const user = message.mentions.members.first() || message.member;
    const embed = new EmbedBuilder()
      .setTitle(user.user.tag)
      .setThumbnail(user.user.displayAvatarURL())
      .addFields(
        { name: 'ID', value: user.id, inline: true },
        { name: 'Roles', value: user.roles.cache.map(r => r.toString()).slice(0, 10).join(', ') || 'None' }
      )
      .setColor('#5865F2');
    message.reply({ embeds: [embed] });
  }

  if (command === 'avatar') {
    const user = message.mentions.users.first() || message.author;
    const embed = new EmbedBuilder()
      .setTitle(user.tag + ' Avatar')
      .setImage(user.displayAvatarURL({ size: 512 }))
      .setColor('#5865F2');
    message.reply({ embeds: [embed] });
  }

  if (command === 'ping') {
    message.reply('Pong! Latency: ' + (Date.now() - message.createdTimestamp) + 'ms');
  }

  // ==================== FUN ====================

  if (command === '8ball') {
    const responses = ['Yes!', 'No.', 'Maybe...', 'Absolutely!', 'Never!', 'Ask again later.', 'Definitely!', 'I doubt it.'];
    message.reply(responses[Math.floor(Math.random() * responses.length)]);
  }

  if (command === 'coinflip') {
    message.reply(Math.random() > 0.5 ? 'Heads!' : 'Tails!');
  }

  if (command === 'dice') {
    message.reply('You rolled: ' + (Math.floor(Math.random() * 6) + 1));
  }

  // ==================== ROLES ====================

  if (command === 'role') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles))
      return message.reply('You need Manage Roles permission.');
    const user = message.mentions.members.first();
    const role = message.mentions.roles.first();
    if (!user || !role) return message.reply('Please mention a user and role.');
    if (user.roles.cache.has(role.id)) {
      await user.roles.remove(role);
      message.reply('Removed ' + role.name + ' from ' + user.user.tag);
    } else {
      await user.roles.add(role);
      message.reply('Added ' + role.name + ' to ' + user.user.tag);
    }
  }
});

// Ticket button handler
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  
  if (interaction.customId === 'create_ticket') {
    const ticketChannel = await interaction.guild.channels.create({
      name: 'ticket-' + interaction.user.username,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      ],
    });
    
    const embed = new EmbedBuilder()
      .setTitle('Ticket Created')
      .setDescription('Hello ' + interaction.user + '! Support will be with you shortly. Use !ticket close to close this ticket.')
      .setColor('#00ff00');
    
    const closeBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('close_ticket')
        .setLabel('Close Ticket')
        .setStyle(ButtonStyle.Danger)
    );
    
    await ticketChannel.send({ embeds: [embed], components: [closeBtn] });
    await interaction.reply({ content: 'Ticket created: ' + ticketChannel, ephemeral: true });
  }
  
  if (interaction.customId === 'close_ticket') {
    await interaction.channel.delete();
  }
});

// Login with token
client.login(process.env.MTQ0NTAyMDgyMjk1MDY0NTgxMQ.Gb46FY.c2oEPmJW0Lu52zKYtkvcUj7KBojUF9Ps9GXCH4);

