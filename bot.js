const fs = require('fs');
require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionsBitField,
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const BOT_OWNER_ID = '767540134572458076'; 
const BOT_OWNER_GUILD_ID = '1027958226387472467'; 
const START_DATE = new Date('2024-10-27'); 

function getCurrentDayNumber() {
  const currentDate = new Date();
  const differenceInTime = currentDate - START_DATE;
  const differenceInDays = Math.floor(differenceInTime / (1000 * 60 * 60 * 24));
  return differenceInDays + 1; 
}

// local time
function getCurrentTimeString() {
  const currentDate = new Date();
  return currentDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// load channels
let channels = { primaryChannel: {}, relayChannels: {} };
try {
  const data = fs.readFileSync('channels.json', 'utf-8');
  channels = JSON.parse(data);
} catch (error) {
  console.error('Could not read channels.json, starting with empty settings.');
}

// save channel settings
function saveChannels() {
  fs.writeFileSync('channels.json', JSON.stringify(channels, null, 2));
}

// register commands
async function registerCommands() {
  const setChannelCommand = new SlashCommandBuilder()
    .setName('setchannel')
    .setDescription('Set the channel to receive relayed messages')
    .addChannelOption(option =>
      option.setName('channel').setDescription('The channel to relay messages to').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .setDMPermission(false)
    .toJSON();

  const removeChannelCommand = new SlashCommandBuilder()
    .setName('removechannel')
    .setDescription('Remove the relay channel for this server')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .setDMPermission(false)
    .toJSON();

  const statsCommand = new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show the number of relay channels set and total servers the bot is in.')
    .setDefaultMemberPermissions(0)
    .setDMPermission(false)
    .toJSON();

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    console.log('Registering commands...');

    // register /setchannel and /removechannel globally
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: [setChannelCommand, removeChannelCommand] }
    );
    console.log('/setchannel and /removechannel registered globally.');

    // register /stats on fishtank server
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, BOT_OWNER_GUILD_ID),
      { body: [statsCommand] }
    );
    console.log('/stats registered in the primary server.');

  } catch (error) {
    console.error('Failed to register commands:', error);
  }
}

client.on('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
});

//slash commands
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options } = interaction;

  if (commandName === 'stats') {
    if (interaction.user.id !== BOT_OWNER_ID) {
      return await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    const relayChannelsCount = Object.keys(channels.relayChannels).length;
    const totalServers = client.guilds.cache.size;

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Bot Stats')
          .addFields(
            { name: 'Total Relay Channels Set', value: relayChannelsCount.toString(), inline: true },
            { name: 'Total Servers', value: totalServers.toString(), inline: true }
          )
          .setColor(0x00ae86),
      ],
    });
  }

  if (commandName === 'setchannel') {
    if (!interaction.guild) {
      return await interaction.reply({ content: 'This command can only be used within a server.', ephemeral: true });
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return await interaction.reply({ content: 'Only server administrators can set the relay channel.', ephemeral: true });
    }

    const channel = options.getChannel('channel');
    if (!channel || channel.type !== 0) {
      return await interaction.reply({ content: 'Please select a text channel!', ephemeral: true });
    }

    channels.relayChannels[interaction.guild.id] = channel.id;
    saveChannels();
    await interaction.reply(`Relay channel set to ${channel}`);
  }

  if (commandName === 'removechannel') {
    if (!interaction.guild) {
      return await interaction.reply({ content: 'This command can only be used within a server.', ephemeral: true });
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return await interaction.reply({ content: 'Only server administrators can remove the relay channel.', ephemeral: true });
    }

    if (channels.relayChannels[interaction.guild.id]) {
      delete channels.relayChannels[interaction.guild.id];
      saveChannels();
      await interaction.reply('Relay channel has been removed.');
    } else {
      await interaction.reply('No relay channel is set for this server.');
    }
  }
});

//handling edits and deletes
const relayedMessages = new Map();

client.on('messageCreate', async message => {
  const primaryChannelId = channels.primaryChannel[message.guild.id];
  if (!primaryChannelId || message.channel.id !== primaryChannelId) return;

  const currentDayNumber = getCurrentDayNumber();
  const currentTimeString = getCurrentTimeString();

  const embed = new EmbedBuilder()
    .setAuthor({ name: message.member ? message.member.displayName : message.author.username, iconURL: message.author.displayAvatarURL() })
    .setFooter({ text: `Day ${currentDayNumber} [ ${currentTimeString} ]` });

  if (message.content.trim()) {
    embed.setDescription(message.content);
  }

  const imageAttachment = message.attachments.find(attachment => attachment.contentType?.startsWith('image'));
  if (imageAttachment) {
    embed.setImage(imageAttachment.url);
  }

  const videoAttachment = message.attachments.find(attachment => attachment.contentType?.startsWith('video'));

  for (const [guildId, relayChannelId] of Object.entries(channels.relayChannels)) {
    try {
      const relayChannel = await client.channels.fetch(relayChannelId);
      const sentMessage = await relayChannel.send({
        embeds: [embed],
        files: videoAttachment ? [videoAttachment.url] : []
      });

      if (!relayedMessages.has(message.id)) {
        relayedMessages.set(message.id, new Map());
      }
      relayedMessages.get(message.id).set(guildId, sentMessage.id);
    } catch (error) {
      // handle kicked bot and deleted channels
      if (error.code === 10003 || error.code === 50001) { 
        console.error(`Channel ${relayChannelId} in guild ${guildId} is no longer accessible. Removing from relay channels.`);
        delete channels.relayChannels[guildId];
        saveChannels();
      } else {
        console.error(`Failed to send message to ${relayChannelId} in guild ${guildId}:`, error);
      }
    }
  }
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (!relayedMessages.has(newMessage.id)) return;

  const currentDayNumber = getCurrentDayNumber();
  const currentTimeString = getCurrentTimeString();

  const updatedEmbed = new EmbedBuilder()
    .setAuthor({ name: newMessage.member ? newMessage.member.displayName : newMessage.author.username, iconURL: newMessage.author.displayAvatarURL() })
    .setFooter({ text: `Day ${currentDayNumber} [ ${currentTimeString} ]` });

  if (newMessage.content.trim()) {
    updatedEmbed.setDescription(newMessage.content);
  }

  const imageAttachment = newMessage.attachments.find(attachment => attachment.contentType?.startsWith('image'));
  if (imageAttachment) {
    updatedEmbed.setImage(imageAttachment.url);
  }

  const videoAttachment = newMessage.attachments.find(attachment => attachment.contentType?.startsWith('video'));

  const relayedMessageInfo = relayedMessages.get(newMessage.id);
  for (const [guildId, relayedMessageId] of relayedMessageInfo.entries()) {
    try {
      const relayChannel = await client.channels.fetch(channels.relayChannels[guildId]);
      const relayedMessage = await relayChannel.messages.fetch(relayedMessageId);

      await relayedMessage.edit({
        embeds: [updatedEmbed],
        files: videoAttachment ? [videoAttachment.url] : []
      });
    } catch (error) {
      if (error.code === 10003 || error.code === 50001) {
        console.error(`Channel ${channels.relayChannels[guildId]} in guild ${guildId} is no longer accessible. Removing from relay channels.`);
        delete channels.relayChannels[guildId];
        saveChannels();
      } else {
        console.error(`Failed to update message in guild ${guildId}:`, error);
      }
    }
  }
});

client.on('messageDelete', async (deletedMessage) => {
  if (!relayedMessages.has(deletedMessage.id)) return;

  const relayedMessageInfo = relayedMessages.get(deletedMessage.id);
  for (const [guildId, relayedMessageId] of relayedMessageInfo.entries()) {
    try {
      const relayChannel = await client.channels.fetch(channels.relayChannels[guildId]);
      const relayedMessage = await relayChannel.messages.fetch(relayedMessageId);

      await relayedMessage.delete();
    } catch (error) {
      if (error.code === 10003 || error.code === 50001) {
        console.error(`Channel ${channels.relayChannels[guildId]} in guild ${guildId} is no longer accessible. Removing from relay channels.`);
        delete channels.relayChannels[guildId];
        saveChannels();
      } else {
        console.error(`Failed to delete message in guild ${guildId}:`, error);
      }
    }
  }

  relayedMessages.delete(deletedMessage.id);
});


client.login(process.env.DISCORD_TOKEN);
