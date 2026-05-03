require("dotenv").config();

const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const PREFIX = "!";
const DATA_FILE = path.join(__dirname, "database.json");

const ROLES = {
  vip: {
    name: "VIP",
    id: "1500488481825362106",
    durationMs: 30 * 24 * 60 * 60 * 1000
  },
  member: {
    name: "MEMBER",
    id: "1500488859778154626",
    durationMs: null
  },
  trial: {
    name: "TRIAL",
    id: "1500498726626656457",
    durationMs: 3 * 24 * 60 * 60 * 1000
  },
  admin: {
    name: "ADMIN",
    id: "1500499002905464912",
    durationMs: null
  }
};

const AUTO_ROLE_ID = ROLES.member.id;

const xpCooldown = new Map();
const commandCooldown = new Map();

function loadDB() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ keys: [], users: {} }, null, 2)
    );
  }

  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function saveDB(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function embed(title, description) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}

function isAdmin(message) {
  return message.member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function commandWait(userId, seconds = 4) {
  const now = Date.now();
  const end = commandCooldown.get(userId);

  if (end && now < end) return Math.ceil((end - now) / 1000);

  commandCooldown.set(userId, now + seconds * 1000);
  return 0;
}

function getUser(db, userId) {
  if (!db.users[userId]) {
    db.users[userId] = {
      xp: 0,
      level: 1,
      coins: 0,
      messages: 0
    };
  }

  return db.users[userId];
}

function xpNeeded(level) {
  return level * 120;
}

function generateKey(type) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const parts = [];

  for (let i = 0; i < 4; i++) {
    let part = "";
    for (let j = 0; j < 4; j++) {
      part += chars[Math.floor(Math.random() * chars.length)];
    }
    parts.push(part);
  }

  return `${type.toUpperCase()}-${parts.join("-")}`;
}

function createKey(type, createdBy, lockedTo = null) {
  const db = loadDB();
  let key;

  do {
    key = generateKey(type);
  } while (db.keys.some(k => k.key === key));

  db.keys.push({
    key,
    type,
    roleId: ROLES[type].id,
    used: false,
    usedBy: null,
    createdBy,
    lockedTo,
    createdAt: Date.now(),
    usedAt: null,
    expiresAt: null,
    expired: false,
    reminded: false
  });

  saveDB(db);
  return key;
}

async function removeExpiredRolesAndRemind() {
  const db = loadDB();
  let changed = false;

  for (const keyData of db.keys) {
    if (!keyData.used || !keyData.expiresAt || keyData.expired) continue;

    const remaining = keyData.expiresAt - Date.now();

    // تنبيه قبل 24 ساعة
    if (remaining <= 24 * 60 * 60 * 1000 && remaining > 0 && !keyData.reminded) {
      for (const guild of client.guilds.cache.values()) {
        const member = await guild.members.fetch(keyData.usedBy).catch(() => null);
        if (!member) continue;

        await member.send({
          embeds: [
            embed(
              "⏳ تنبيه انتهاء الاشتراك",
              `اشتراك **${ROLES[keyData.type].name}** بينتهي خلال أقل من 24 ساعة.`
            )
          ]
        }).catch(() => null);
      }

      keyData.reminded = true;
      changed = true;
    }

    // سحب الرتبة بعد الانتهاء
    if (Date.now() >= keyData.expiresAt) {
      for (const guild of client.guilds.cache.values()) {
        const member = await guild.members.fetch(keyData.usedBy).catch(() => null);
        if (!member) continue;

        await member.roles.remove(keyData.roleId).catch(() => null);
        await member.send({
          embeds: [
            embed(
              "⌛ انتهى الاشتراك",
              `تم انتهاء اشتراك **${ROLES[keyData.type].name}** وسحب الرتبة.`
            )
          ]
        }).catch(() => null);
      }

      keyData.expired = true;
      changed = true;
    }
  }

  if (changed) saveDB(db);
}

// Auto Role عند دخول عضو جديد
client.on("guildMemberAdd", async (member) => {
  const role = member.guild.roles.cache.get(AUTO_ROLE_ID);
  if (!role) return;

  await member.roles.add(role).catch(() => null);

  await member.send({
    embeds: [
      embed(
        "👋 أهلاً بك",
        `تم إعطاؤك رتبة **MEMBER** تلقائيًا.\nاستخدم \`${PREFIX}help\` لمعرفة الأوامر.`
      )
    ]
  }).catch(() => null);
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  removeExpiredRolesAndRemind();
  setInterval(removeExpiredRolesAndRemind, 60 * 1000);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const db = loadDB();

  // XP / Levels
  if (!message.content.startsWith(PREFIX)) {
    const last = xpCooldown.get(message.author.id) || 0;

    if (Date.now() - last > 60 * 1000) {
      const user = getUser(db, message.author.id);
      const gain = Math.floor(Math.random() * 10) + 5;

      user.xp += gain;
      user.messages += 1;

      if (user.xp >= xpNeeded(user.level)) {
        user.xp -= xpNeeded(user.level);
        user.level += 1;
        user.coins += 100;

        message.channel.send({
          embeds: [
            embed(
              "🏅 Level Up!",
              `${message.author} وصل إلى Level **${user.level}** وكسب **100 Coins** 🎉`
            )
          ]
        });
      }

      xpCooldown.set(message.author.id, Date.now());
      saveDB(db);
    }

    return;
  }

  const wait = commandWait(message.author.id);
  if (wait) return message.reply(`⏳ انتظر ${wait} ثانية.`);

  const args = message.content.trim().split(/\s+/);
  const command = args[0].toLowerCase();

  if (command === `${PREFIX}help`) {
    return message.reply({
      embeds: [
        embed(
          "📌 أوامر البوت",
          `
👤 **الأعضاء**
\`${PREFIX}profile\`
\`${PREFIX}redeem KEY\`
\`${PREFIX}coin\`
\`${PREFIX}guess 5\`

👑 **الأدمن**
\`${PREFIX}key vip\`
\`${PREFIX}key vip @user\`
\`${PREFIX}keys trial 5\`
\`${PREFIX}keys list\`
\`${PREFIX}keys used\`
\`${PREFIX}keys unused\`
\`${PREFIX}deletekey KEY\`
\`${PREFIX}stats\`

🎭 **الأنواع**
vip / member / trial / admin
`
        )
      ]
    });
  }

  if (command === `${PREFIX}profile`) {
    const user = getUser(db, message.author.id);

    return message.reply({
      embeds: [
        embed(
          "👤 ملفك",
          `
Level: **${user.level}**
XP: **${user.xp}/${xpNeeded(user.level)}**
Coins: **${user.coins}**
Messages: **${user.messages}**
`
        )
      ]
    });
  }

if (command === `${PREFIX}coin`) {
  await message.reply("🪙 اختر: اكتب `heads` أو `tails` خلال 15 ثانية");

  const filter = (m) =>
    m.author.id === message.author.id &&
    ["heads", "tails"].includes(m.content.toLowerCase());

  const collected = await message.channel.awaitMessages({
    filter,
    max: 1,
    time: 15000
  });

  if (collected.size === 0) {
    return message.reply("⏰ انتهى الوقت، ما اخترت.");
  }

  const userChoice = collected.first().content.toLowerCase();
  const result = Math.random() < 0.5 ? "heads" : "tails";

  const user = getUser(db, message.author.id);

  if (userChoice === result) {
    user.coins += 50;
    saveDB(db);

    return message.reply(
      `🪙 اختيارك: **${userChoice}**\n` +
      `🎲 النتيجة: **${result}**\n\n` +
      `🎉 فزت وكسبت **50 Coins**!`
    );
  }

  saveDB(db);

  return message.reply(
    `🪙 اختيارك: **${userChoice}**\n` +
    `🎲 النتيجة: **${result}**\n\n` +
    `❌ خسرت.`
  );
}

if (command === `${PREFIX}guess`) {
  const guess = parseInt(args[1]);

  if (!guess || guess < 1 || guess > 10) {
    return message.reply(`❌ خمن رقم من 1 إلى 10:\n\`${PREFIX}guess 5\``);
  }

  const number = Math.floor(Math.random() * 10) + 1;
  const user = getUser(db, message.author.id);

  if (guess === number) {
    user.coins += 100;
    saveDB(db);

    return message.reply(`🎉 صح! الرقم كان **${number}** وكسبت **100 Coins**.`);
  }

  saveDB(db);
  return message.reply(`❌ غلط! الرقم كان **${number}**.`);
}

  if (command === `${PREFIX}redeem`) {
    const userKey = args[1];
    if (!userKey) return message.reply(`❌ اكتب:\n\`${PREFIX}redeem KEY\``);

    const keyData = db.keys.find(k => k.key === userKey);
    if (!keyData) return message.reply("❌ الكود غير صحيح.");
    if (keyData.used) return message.reply("❌ الكود مستخدم من قبل.");

    if (keyData.lockedTo && keyData.lockedTo !== message.author.id) {
      return message.reply("🔒 هذا الكود مخصص لشخص آخر.");
    }

    const role = message.guild.roles.cache.get(keyData.roleId);
    if (!role) return message.reply("❌ الرتبة غير موجودة.");

    if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return message.reply("❌ البوت يحتاج صلاحية Manage Roles.");
    }

    try {
      await message.member.roles.add(role);

      keyData.used = true;
      keyData.usedBy = message.author.id;
      keyData.usedAt = Date.now();

      if (ROLES[keyData.type].durationMs) {
        keyData.expiresAt = Date.now() + ROLES[keyData.type].durationMs;
      }

      saveDB(db);

      const expireText = keyData.expiresAt
        ? `<t:${Math.floor(keyData.expiresAt / 1000)}:R>`
        : "دائم";

      return message.reply({
        embeds: [
          embed(
            "✅ تم التفعيل",
            `تم إعطاؤك رتبة **${ROLES[keyData.type].name}** 🎉\nالانتهاء: **${expireText}**`
          )
        ]
      });
    } catch {
      return message.reply("❌ ما قدرت أعطيك الرتبة. تأكد أن رتبة البوت أعلى من الرتبة.");
    }
  }

  const adminCommands = [
    `${PREFIX}key`,
    `${PREFIX}keys`,
    `${PREFIX}deletekey`,
    `${PREFIX}stats`
  ];

  if (adminCommands.includes(command) && !isAdmin(message)) {
    return message.reply("❌ هذا الأمر للأدمن فقط.");
  }

  if (command === `${PREFIX}key`) {
    const type = args[1]?.toLowerCase();
    const target = message.mentions.users.first();

    if (!ROLES[type]) {
      return message.reply("❌ الأنواع: vip / member / trial / admin");
    }

    const key = createKey(type, message.author.id, target?.id || null);

    const lockedText = target ? `\n🔒 مخصص لـ: ${target}` : "";

    try {
      await message.author.send({
        embeds: [
          embed(
            `🔑 ${ROLES[type].name} Key`,
            `\`${key}\`${lockedText}\n\n\`${PREFIX}redeem ${key}\``
          )
        ]
      });

      return message.reply("✅ تم إرسال الكود لك في الخاص.");
    } catch {
      return message.reply(`🔑 الكود:\n\`${key}\`${lockedText}`);
    }
  }

  if (command === `${PREFIX}keys`) {
    const sub = args[1]?.toLowerCase();

    if (["list", "used", "unused"].includes(sub)) {
      let filtered = db.keys;

      if (sub === "used") filtered = db.keys.filter(k => k.used);
      if (sub === "unused") filtered = db.keys.filter(k => !k.used);

      const output = filtered
        .slice(0, 20)
        .map((k, i) => {
          const status = k.used ? "Used" : "Unused";
          const locked = k.lockedTo ? ` | Locked: ${k.lockedTo}` : "";
          return `${i + 1}. ${k.key} | ${k.type} | ${status}${locked}`;
        })
        .join("\n") || "لا يوجد نتائج.";

      return message.reply({
        embeds: [
          embed(
            `📋 Keys ${sub}`,
            `\`\`\`\n${output}\n\`\`\`\nيعرض أول 20 نتيجة فقط.`
          )
        ]
      });
    }

    const type = sub;
    const amount = parseInt(args[2]);

    if (!ROLES[type]) return message.reply("❌ الأنواع: vip / member / trial / admin");
    if (!amount || amount <= 0) return message.reply(`❌ مثال:\n\`${PREFIX}keys vip 5\``);
    if (amount > 50) return message.reply("❌ الحد الأقصى 50.");

    const keys = [];
    for (let i = 0; i < amount; i++) {
      keys.push(`${i + 1}. ${createKey(type, message.author.id)}`);
    }

    try {
      await message.author.send({
        embeds: [
          embed(
            `🔑 ${amount} ${ROLES[type].name} Keys`,
            `\`\`\`\n${keys.join("\n")}\n\`\`\``
          )
        ]
      });

      return message.reply("✅ تم إرسال الأكواد في الخاص.");
    } catch {
      return message.reply(`\`\`\`\n${keys.join("\n")}\n\`\`\``);
    }
  }

  if (command === `${PREFIX}deletekey`) {
    const key = args[1];
    if (!key) return message.reply(`❌ اكتب:\n\`${PREFIX}deletekey KEY\``);

    const index = db.keys.findIndex(k => k.key === key);
    if (index === -1) return message.reply("❌ الكود غير موجود.");

    const deleted = db.keys.splice(index, 1)[0];
    saveDB(db);

    return message.reply({
      embeds: [
        embed(
          "🗑️ تم حذف الكود",
          `\`${deleted.key}\`\nالنوع: **${deleted.type}**`
        )
      ]
    });
  }

  if (command === `${PREFIX}stats`) {
    const total = db.keys.length;
    const used = db.keys.filter(k => k.used).length;
    const unused = db.keys.filter(k => !k.used).length;
    const expired = db.keys.filter(k => k.expired).length;

    return message.reply({
      embeds: [
        embed(
          "📊 الإحصائيات",
          `
Keys Total: **${total}**
Used: **${used}**
Unused: **${unused}**
Expired: **${expired}**
Users: **${Object.keys(db.users).length}**
`
        )
      ]
    });
  }
});

client.login(process.env.DISCORD_TOKEN);