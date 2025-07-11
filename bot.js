require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const express = require('express');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers
    ]
});

const CONFIG_PATH = './config.json';
const WARNINGS_PATH = './warnings.json';

let config = JSON.parse(fs.readFileSync(CONFIG_PATH));
let warnings = JSON.parse(fs.readFileSync(WARNINGS_PATH));

function saveWarnings() {
    fs.writeFileSync(WARNINGS_PATH, JSON.stringify(warnings, null, 2));
}

function saveConfig() {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Express server para UptimeRobot
const app = express();
app.get('/', (req, res) => res.send('WTJ Strike Staff Bot is running!'));
const listener = app.listen(process.env.PORT || 3000, () => {
    console.log(`Express server running on port ${listener.address().port}`);
});

client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

// Setup comandos slash
const commands = [
    new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Issue a warning to a staff member')
        .addUserOption(opt => opt.setName('user').setDescription('User to warn').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for warning').setRequired(true)),

    new SlashCommandBuilder()
        .setName('warnings')
        .setDescription('View warnings of a user')
        .addUserOption(opt => opt.setName('user').setDescription('User to check').setRequired(true)),

    new SlashCommandBuilder()
        .setName('resetwarnings')
        .setDescription('Reset warnings of a user')
        .addUserOption(opt => opt.setName('user').setDescription('User to reset').setRequired(true)),

    new SlashCommandBuilder()
        .setName('setembedicon')
        .setDescription('Set the embed icon URL')
        .addStringOption(opt => opt.setName('url').setDescription('New embed icon URL').setRequired(true)),

    new SlashCommandBuilder()
        .setName('setwarningchannel')
        .setDescription('Set the warning log channel ID')
        .addStringOption(opt => opt.setName('channelid').setDescription('New warning channel ID').setRequired(true)),

    new SlashCommandBuilder()
        .setName('setwarnpermission')
        .setDescription('Set roles allowed to warn')
        .addStringOption(opt => opt.setName('roleids').setDescription('Comma-separated role IDs').setRequired(true)),

    new SlashCommandBuilder()
        .setName('setresetpermission')
        .setDescription('Set roles allowed to reset warnings')
        .addStringOption(opt => opt.setName('roleids').setDescription('Comma-separated role IDs').setRequired(true)),

    new SlashCommandBuilder()
        .setName('setconfigpermission')
        .setDescription('Set roles allowed to change bot config')
        .addStringOption(opt => opt.setName('roleids').setDescription('Comma-separated role IDs').setRequired(true))
]
.map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('ready', async () => {
    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('✅ Slash commands registered.');
    } catch (error) {
        console.error(error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName, options, member, guild } = interaction;

    if (commandName === 'warn') {
        if (!member.roles.cache.some(r => config.warnPermissionRoles.includes(r.id))) {
            return interaction.reply({ content: '❌ You do not have permission to issue warnings.', ephemeral: true });
        }

        const user = options.getUser('user');
        const reason = options.getString('reason');
        const now = new Date().toLocaleString();

        if (!warnings[user.id]) warnings[user.id] = [];
        warnings[user.id].push({
            reason,
            date: now,
            issuer: member.user.tag
        });
        saveWarnings();

        const count = warnings[user.id].length;
        let color = 0xffff00; // yellow for 1st warning
        if (count === 2) color = 0xffa500; // orange for 2nd
        if (count >= 3) color = 0xff0000; // red for 3rd+

        const embed = new EmbedBuilder()
            .setColor(color)
            .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
            .setThumbnail(config.embedIcon)
            .setImage(config.embedBanner)
            .setTitle(`⚠️ Warning #${count}`)
            .addFields(
                { name: 'Reason', value: reason },
                { name: 'Issued by', value: member.user.tag },
                { name: 'Date', value: now }
            )
            .setFooter({ text: config.embedFooter });

        const channel = await guild.channels.fetch(config.warningChannelId);
        await channel.send({ content: `${user}`, embeds: [embed] });

        if (count === 3) {
            const memberObj = await guild.members.fetch(user.id);

            // Remove demoteRoles except protectedRole (#WTJFamily)
            const rolesToRemove = memberObj.roles.cache.filter(role =>
                config.demoteRoles.includes(role.id) && role.id !== config.protectedRole
            );
            await memberObj.roles.remove(rolesToRemove);

            // Add #WTJFamily if not present
            if (!memberObj.roles.cache.has(config.protectedRole)) {
                await memberObj.roles.add(config.protectedRole);
            }

            await channel.send(`🔴 ${user} has been demoted. Staff roles removed.`);
        }

        interaction.reply({ content: `✅ Warning issued to ${user.tag}`, ephemeral: true });
    }

    else if (commandName === 'warnings') {
        const user = options.getUser('user');
        const userWarnings = warnings[user.id] || [];
        if (userWarnings.length === 0) {
            return interaction.reply(`✅ ${user.tag} has no warnings.`);
        }

        let desc = '';
        userWarnings.forEach((w, i) => {
            desc += `**${i + 1}.** ${w.reason} (by ${w.issuer} on ${w.date})\n`;
        });

        const embed = new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle(`📋 Warnings for ${user.tag}`)
            .setDescription(desc)
            .setFooter({ text: config.embedFooter });

        interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'resetwarnings') {
        if (!member.roles.cache.some(r => config.resetPermissionRoles.includes(r.id))) {
            return interaction.reply({ content: '❌ You do not have permission to reset warnings.', ephemeral: true });
        }

        const user = options.getUser('user');
        delete warnings[user.id];
        saveWarnings();
        interaction.reply(`♻️ All warnings for ${user.tag} have been reset.`);
    }

    else if (commandName === 'setembedicon') {
        if (!member.roles.cache.some(r => config.configPermissionRoles.includes(r.id))) {
            return interaction.reply({ content: '❌ You do not have permission to change config.', ephemeral: true });
        }

        const url = options.getString('url');
        config.embedIcon = url;
        saveConfig();
        interaction.reply(`✅ Embed icon updated.`);
    }

    else if (commandName === 'setwarningchannel') {
        if (!member.roles.cache.some(r => config.configPermissionRoles.includes(r.id))) {
            return interaction.reply({ content: '❌ You do not have permission to change config.', ephemeral: true });
        }

        const newId = options.getString('channelid');
        config.warningChannelId = newId;
        saveConfig();
        interaction.reply(`✅ Warning channel updated.`);
    }

    else if (commandName === 'setwarnpermission') {
        if (!member.roles.cache.some(r => config.configPermissionRoles.includes(r.id))) {
            return interaction.reply({ content: '❌ You do not have permission to change config.', ephemeral: true });
        }

        const roleIdsString = options.getString('roleids');
        config.warnPermissionRoles = roleIdsString.split(',').map(r => r.trim());
        saveConfig();
        interaction.reply(`✅ Warn permission roles updated.`);
    }

    else if (commandName === 'setresetpermission') {
        if (!member.roles.cache.some(r => config.configPermissionRoles.includes(r.id))) {
            return interaction.reply({ content: '❌ You do not have permission to change config.', ephemeral: true });
        }

        const roleIdsString = options.getString('roleids');
        config.resetPermissionRoles = roleIdsString.split(',').map(r => r.trim());
        saveConfig();
        interaction.reply(`✅ Reset permission roles updated.`);
    }

    else if (commandName === 'setconfigpermission') {
        if (!member.roles.cache.some(r => config.configPermissionRoles.includes(r.id))) {
            return interaction.reply({ content: '❌ You do not have permission to change config.', ephemeral: true });
        }

        const roleIdsString = options.getString('roleids');
        config.configPermissionRoles = roleIdsString.split(',').map(r => r.trim());
        saveConfig();
        interaction.reply(`✅ Config permission roles updated.`);
    }
});

client.login(process.env.DISCORD_TOKEN);
