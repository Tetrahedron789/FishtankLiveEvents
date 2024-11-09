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
    GatewayIntentBits.MessageContent,
  ],
});

const BOT_OWNER_ID = '767540134572458076'; 
const BOT_OWNER_GUILD_ID = '1098155245177163777'; 
const START_DATE = new Date('2024-10-27'); 

// Function to calculate the current day number
function getCurrentDayNumber() {
  const currentDate = new Date();
  const differenceInTime = currentDate - START_DATE;
  const differenceInDays = Math.floor(differenceInTime / (1000 * 60 * 60 * 24));
  return differenceInDays + 1; // Add 1 to start count from Day 1
}

// Function to get the local system time as a formatted string
function getCurrentTimeString() {
  const currentDate = new Date();
  return currentDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Load channel settings from channels.json
let channels = { primaryChannel: {}, relayChannels: {} };
try {
  const data = fs.readFileSync('channels.json', 'utf-8');
  channels = JSON.parse(data);
} catch (error) {
  console.error('Could not read channels.json, starting with empty settings.');
}

// Function to save channel settings to channels.json
function saveChannels() {
  fs.writeFileSync('channels.json', JSON.stringify(channels, null, 2));
}

// Register commands
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

    // Register /setchannel and /removechannel as global commands
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: [setChannelCommand, removeChannelCommand] }
    );
    console.log('/setchannel and /removechannel registered globally.');

    // Register /stats as a guild-specific command in the primary server
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


// Handling slash commands
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options } = interaction;

  if (commandName === 'stats') {
    // Allow the bot owner, users with the specified role, or administrators in the primary server
    const hasPermission =
      interaction.user.id === BOT_OWNER_ID ||
      (interaction.guild &&
        (await interaction.guild.members.fetch(interaction.user.id)).permissions.has(PermissionsBitField.Flags.Administrator)) ||
      (interaction.guild &&
        (await interaction.guild.members.fetch(interaction.user.id)).roles.cache.has('1191011204479598712'));
  
    if (!hasPermission) {
      return await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }
  
    // Command logic for /stats
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
      return await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setDescription('This command can only be used within a server.')
            .setColor(0xFF0000) // Red color for error
        ],
        ephemeral: true
      });
    }
  
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setDescription('Only server administrators can set the relay channel.')
            .setColor(0x8A0000) // Red color for error
        ],
        ephemeral: true
      });
    }
  
    const channel = options.getChannel('channel');
    if (!channel || (channel.type !== 0 && channel.type !== 5)) {
      return await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setDescription('Please select a text or announcement channel!')
            .setColor(0x8A0000) // Red color for error
        ],
        ephemeral: true
      });
    }
  
    // Fetch the bot's member object in the guild to check permissions
    const botMember = await interaction.guild.members.fetch(client.user.id);
  
    // Check if the bot has the necessary permissions in the selected channel
    const requiredPermissions = [
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.EmbedLinks,
      PermissionsBitField.Flags.AttachFiles,
    ];
  
    const botPermissions = channel.permissionsFor(botMember);
    const missingPermissions = requiredPermissions.filter(permission => !botPermissions.has(permission));
  
    if (missingPermissions.length > 0) {
      const missingPermissionsNames = missingPermissions.map(permission => {
        switch (permission) {
          case PermissionsBitField.Flags.ViewChannel:
            return '`View Channel`';
          case PermissionsBitField.Flags.SendMessages:
            return '`Send Messages`';
          case PermissionsBitField.Flags.EmbedLinks:
            return '`Embed Links`';
          case PermissionsBitField.Flags.AttachFiles:
            return '`Attach Files`';
          default:
            return '`Unknown Permission`';
        }
      }).join(', ');
  
      return await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('Permission Error')
            .setDescription(`Permissions missing in ${channel}: \n${missingPermissionsNames}\n\nPlease ensure I have these permissions.`)
            .setColor(0x8A0000) // Red color for error
        ],
        ephemeral: true
      });
    }
  
    // If all permissions are present, set the channel as the relay channel
    channels.relayChannels[interaction.guild.id] = channel.id;
    saveChannels();
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Success')
          .setDescription(`Relay channel set to ${channel}`)
          .setColor(0x008A00) // Green color for success
      ]
    });
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

// Map to store relayed messages for handling edits and deletions
const startDate = new Date('2024-10-27'); // Define the start date for "Day 1"
const relayedMessages = new Map(); // Track original and relayed message IDs for edits

client.on('messageCreate', async message => {
  await handleMessageRelay(message);
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (relayedMessages.has(newMessage.id)) {
    await handleMessageRelay(newMessage, true);
  }
});

async function handleMessageRelay(message, isEdit = false) {
  const primaryChannelId = channels.primaryChannel[message.guild.id];
  if (!primaryChannelId || message.channel.id !== primaryChannelId) return;

  const currentDate = new Date();
  const dayCount = Math.floor((currentDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

  const embed = new EmbedBuilder()
    .setAuthor({ name: message.member ? message.member.displayName : message.author.username, iconURL: message.author.displayAvatarURL() })
    .setFooter({ text: `Day ${dayCount}` }) // Footer with "Day ##"

  // Handle description based on content and attachments
  if (message.content && message.content.trim().length > 0) {
    embed.setDescription(message.content);
  } else if (message.attachments.some(att => att.contentType?.startsWith('video'))) {
    embed.setDescription(null); // No description for videos only
  } else if (message.attachments.some(att => att.contentType?.startsWith('image'))) {
    embed.setDescription(null); // No description for images only
  } else {
    embed.setDescription('No text content'); // Fallback if no text, image, or video
  }

  const maxFileSize = 8 * 1024 * 1024; // 8 MB limit for Discord attachments
  const oversizedFileLinks = [];
  let imageAttachmentUrl = null;

  // Separate attachments: images in embed, videos as links
  for (const attachment of message.attachments.values()) {
    if (attachment.contentType?.startsWith('image') && !imageAttachmentUrl) {
      imageAttachmentUrl = attachment.url; // Use first image as embed image
    } else if (attachment.contentType?.startsWith('video')) {
      oversizedFileLinks.push(attachment.url); // Video links outside embed
    }
  }

  // Set image in embed if there’s an image attachment
  if (imageAttachmentUrl) {
    embed.setImage(imageAttachmentUrl);
  }

  for (const [guildId, relayChannelId] of Object.entries(channels.relayChannels)) {
    try {
      const relayChannel = await client.channels.fetch(relayChannelId);

      if (isEdit && relayedMessages.get(message.id)?.has(guildId)) {
        // Edit the relayed message if it exists
        const relayedMessageId = relayedMessages.get(message.id).get(guildId);
        const relayedMessage = await relayChannel.messages.fetch(relayedMessageId);
        await relayedMessage.edit({ embeds: [embed] });
      } else {
        // Send the main embed
        const sentMessage = await relayChannel.send({ embeds: [embed] });

        // Track the relayed message ID for future edits
        if (!relayedMessages.has(message.id)) {
          relayedMessages.set(message.id, new Map());
        }
        relayedMessages.get(message.id).set(guildId, sentMessage.id);
      }

      // Send video links as a follow-up message, if any
      if (oversizedFileLinks.length > 0) {
        await relayChannel.send(
          `The following video(s) were included in the message:\n${oversizedFileLinks.join('\n')}`
        );
      }
    } catch (error) {
      console.error(`Failed to send or update message in ${relayChannelId} in guild ${guildId}:`, error);
    }
  }
}



// Handle message deletions
client.on('messageDelete', async (deletedMessage) => {
  if (!relayedMessages.has(deletedMessage.id)) return;

  for (const [guildId, relayMessageId] of relayedMessages.get(deletedMessage.id).entries()) {
    try {
      const relayChannel = await client.channels.fetch(channels.relayChannels[guildId.split('-')[0]]);
      const relayedMessage = await relayChannel.messages.fetch(relayMessageId);
      await relayedMessage.delete();
    } catch (error) {
      console.error(`Failed to delete message in guild ${guildId}:`, error);
    }
  }

  // Remove the entry from the map
  relayedMessages.delete(deletedMessage.id);
});


// Log in to Discord
client.login(process.env.DISCORD_TOKEN);
