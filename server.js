// ===== Подключение модулей, объявление большей части глобальных констант и переменных =====

// npm install fs path readline-sync gpt-tokenizer crypto express @google/generative-ai mysql2
const fs = require('fs');
const path = require('path');
const readline = require('readline-sync');
const tokenizer = require('gpt-tokenizer'); // Приблизительная оценка числа токенов без использования интернет-трафика.
const crypto = require('crypto');
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mysql = require('mysql2');

const projectPaths = {
	website: path.join(__dirname, 'website'),
	configuration: path.join(__dirname, 'configuration.json'),
	apiKeys: {
		list: path.join(__dirname, 'api_keys', 'list.json'),
		selected: path.join(__dirname, 'api_keys', 'selected.txt')
	},
	instructions: path.join(__dirname, 'instructions.md'),
	history: path.join(__dirname, 'history.json'),
	log: path.join(__dirname, 'log.txt')
};

let settings = {
	webServer: {
		port: 3000,
		password: ''
	},
	usedApi: {
		name: '',
		model: '',
		tokensLimit: 0,
		provideMetadata: false
	},
	mysqlServer: {
		host: 'localhost',
		port: 3306,
		user: 'root',
		password: ''
	}
};

const listOfCommands = [
	'RequestForMySQL'
];

let apiKey;
let chatMessages;
let serverChatHash;
let instructionsForModel;
let messagesForApi;
let waitingForResponse = false;
let rememberedWebServerPort;
let mysqlConnectionParameters;
let mysqlPool;



// ===== Функции для валидации значений =====

function isNotStructure(value, designation) {
	let problem;
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		problem = `Значение «${designation}» не является структурой.`;
	}
	return problem;
}

function isNotNotEmptyString(value, designation) {
	let problem;
	if (typeof value !== 'string' || value.trim() === '') {
		problem = `Значение «${designation}» не является непустой строкой.`;
	}
	return problem;
}

function isNotArray(value, designation) {
	let problem;
	if (!Array.isArray(value)) {
		problem = `Значение «${designation}» не является массивом.`;
	}
	return problem;
}

function isNotServerPort(value, designation) {
	let problem;
	if (!Number.isInteger(value) || value < 0 || value > 65535) {
		problem = `Значение «${designation}» не является портом сервера.`;
	}
	return problem;
}

function isNotNaturalNumber(value, designation) {
	let problem;
	if (!Number.isInteger(value) || value <= 0) {
		problem = `Значение «${designation}» не является натуральным числом.`;
	}
	return problem;
}

function isNotBoolean(value, designation) {
	let problem;
	if (typeof value !== 'boolean') {
		problem = `Значение «${designation}» не является логическим типом данных.`;
	}
	return problem;
}

function isNotInteger(value, designation) {
	let problem;
	if (!Number.isInteger(value)) {
		problem = `Значение «${designation}» не является целым числом.`;
	}
	return problem;
}



// ===== Вспомогательные функции =====

function finishProcess() {
	readline.question('Программа завершает свою работу. Нажмите «Enter» для выхода.');
	process.exit();
}

function getTimestamp(timestamp = Date.now()) {
	const givenTime = new Date(timestamp)
	const days = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
	const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' };
	const hours = givenTime.getHours();
	let sector;
	if (hours === 23 || hours === 0) {
		sector = 'Ночь';
	} else if (hours >= 1 && hours <= 5) {
		sector = 'Глубокая ночь';
	} else if (hours >= 6 && hours <= 8) {
		sector = 'Раннее утро';
	} else if (hours >= 9 && hours <= 11) {
		sector = 'Утро';
	} else if (hours >= 12 && hours <= 16) {
		sector = 'День';
	} else if (hours >= 17 && hours <= 20) {
		sector = 'Вечер';
	} else {
		sector = 'Поздний вечер';
	}
	return `[${new Intl.DateTimeFormat('ru-RU', options).format(givenTime)} — ${days[givenTime.getDay()]}, ${sector}]`;
}

function formatErrorMessage(structure) {
	const failureCase = 'Не удалось описать исключительную ситуацию →';
	let problem;
	problem = isNotStructure(structure, 'Структура ошибки');
	if (problem) {
		return `${failureCase} ${problem}`;
	}
	problem = isNotNotEmptyString(structure.message, 'Сообщение об ошибке');
	if (problem) {
		return `${failureCase} ${problem}`;
	}

	let result = structure.message.trim();
	const sentenceEnd = '.';
	if (!result.endsWith(sentenceEnd)) {
		result += sentenceEnd;
	}
	return result;
}

function appendIntoFile(objectPath, content) {
	try {
		fs.mkdirSync(path.dirname(objectPath), { recursive: true });
		fs.appendFileSync(objectPath, content, 'utf-8');
	} catch (error) {
		console.error(`Дозапись файла «${path.relative(__dirname, objectPath)}» не произошла → ${formatErrorMessage(error)}`);
		finishProcess();
	}
}

function writeIntoFile(objectPath, content) {
	try {
		fs.mkdirSync(path.dirname(objectPath), { recursive: true });
		fs.writeFileSync(objectPath, content, 'utf-8');
	} catch (error) {
		console.error(`Не удалось перезаписать файл «${path.relative(__dirname, objectPath)}» → ${formatErrorMessage(error)}`);
		finishProcess();
	}
}

function simplificationNumeral(number) {
	if (number > 19 && number < 100) {
		return number % 10;
	}
	if (number > 99) {
		number = number % 100;
		if (number > 19 && number < 100) {
			return number % 10;
		}
	}
	return number;
}

/**
 * Спрягает существительное с числительным.
 * @param {Number} number Число, с которым будет спрягаться существительное.
 * @param {String} foundation Неизменяемая часть слова.
 * @param {String} additionOne Продолжение слова, которое будет использовано, когда число равно 0 или больше 4.
 * @param {String} additionTwo Продолжение слова, которое будет использовано, когда число равно 1.
 * @param {String} additionThree Продолжение слова, которое будет использовано, когда число равно 2, 3 или 4.
 */
function matchWord(number, foundation, additionOne, additionTwo, additionThree) {
	number = simplificationNumeral(number);
	if (number === 0 || number > 4) {
		return foundation + additionOne;
	}
	if (number === 1) {
		return foundation + additionTwo;
	}
	return foundation + additionThree;
}



// ===== Переопределение методов консоли =====

const originalConsoleLog = console.log;
const originalConsoleError = console.error;
console.log = function(content) {
	const record = `[LOG] ${getTimestamp()} ${content}`;
	originalConsoleLog(record);
	appendIntoFile(projectPaths.log, record + '\n');
};
console.error = function(content) {
	const record = `[ERROR] ${getTimestamp()} ${content}`;
	originalConsoleError(record);
	appendIntoFile(projectPaths.log, record + '\n');
};



// ===== Валидация текстового файла и получение его содержимого =====

function binaryFileExpectation(filePath) {
	const fileBuffer = fs.readFileSync(filePath);
	let isBinary = false;
	let fileContent;
	try {
		fileContent = fileBuffer.toString('utf-8');
		if (fileBuffer.some(byte => byte === 0)) {
			isBinary = true;
			fileContent = undefined;
		}
	} catch (error) {
		isBinary = true;
		fileContent = undefined;
	}
	return { isBinary, fileContent };
}

function validateFileAndGetText(objectPath) {
	if (!fs.existsSync(objectPath)) {
		throw new Error('Объект по указанному пути не найден.');
	}
	if (!fs.statSync(objectPath).isFile()) {
		throw new Error('Указанный путь ведёт к объекту, который не является файлом.');
	}
	const { isBinary, fileContent } = binaryFileExpectation(objectPath);
	if (isBinary) {
		throw new Error('Файл является бинарным и не может быть прочитан как текст.');
	}
	return fileContent;
}



// ===== Проверка и чтение файлов проекта =====

/**
 * Рекурсивно извлекает все строковые значения из вложенного объекта.
 * @param {object} structure Объект для обхода.
 * @returns {string[]} Массив всех найденных строковых значений.
 */
function getAllStringValues(structure) {
    // Метод flatMap позволяет обойти значения объекта с автоматическим "разглаживанием" вложенных массивов.
    return Object.values(structure).flatMap(value => {
        if (typeof value === 'string') {
			return value;
		} else if (typeof value === 'object' && value !== null) {
			return getAllStringValues(value);
		}
        return []; // Игнорирование других типов данных.
    });
}

const allProjectPaths = getAllStringValues(projectPaths);

/**
 * Используется исключительно ради корректности отображения path.relative(__dirname, objectPath).
 */
function testForProjectPath(objectPath) {
	if (!allProjectPaths.includes(objectPath)) {
		console.error(`Переданный путь «${objectPath}» не относится к проекту.`);
		finishProcess();
	}
}

function readProjectFileContent(objectPath, couldBeEmpty) {
	testForProjectPath(objectPath);
	const relativePath = path.relative(__dirname, objectPath);
	let fileContent = '';
	let didFileExist = false;
	if (!fs.existsSync(objectPath)) {
		writeIntoFile(objectPath, '');
		const feedback = `Создан пустой файл «${relativePath}».`;
		if (!couldBeEmpty) {
			console.error(`${feedback} Его необходимо заполнить.`);
			finishProcess();
		}
		console.log(feedback);
	} else {
		didFileExist = true;
	}
	if (didFileExist) {
		try {
			fileContent = validateFileAndGetText(objectPath);
		} catch (error) {
			console.error(`Произошла ошибка во время чтения файла «${relativePath}» → ${formatErrorMessage(error)}`);
			finishProcess();
		}
		if (!couldBeEmpty && fileContent === '') {
			console.error(`Файл «${relativePath}» не может быть пустым.`);
			finishProcess();
		}
	}
	return fileContent;
}

function readArrayFromProjectFile(objectPath) {
	testForProjectPath(objectPath);
	const relativePath = path.relative(__dirname, objectPath);
	let collection = [];
	if (!fs.existsSync(objectPath)) {
		writeIntoFile(objectPath, JSON.stringify(collection));
		console.log(`Был создан файл «${relativePath}» с пустым массивом.`);
	} else {
		let parsedContent;
		try {
			parsedContent = JSON.parse(validateFileAndGetText(objectPath));
		} catch (error) {
			console.error(`Неудачная попытка чтения массива из файла «${relativePath}» → ${formatErrorMessage(error)}`);
			finishProcess();
		}
		if (!isNotArray(parsedContent, 'Массив, загруженный из файла')) {
			collection = parsedContent;
		} else {
			console.error(`Содержимое файла «${relativePath}» не представляет собой массив.`);
			finishProcess();
		}
	}
	return collection;
}



// ===== Получение конфигурации и обработка API-ключей =====

function readConfiguration() {
	const projectObject = projectPaths.configuration;
	const relativePath = path.relative(__dirname, projectObject);
	if (!fs.existsSync(projectObject)) {
		writeIntoFile(projectObject, JSON.stringify(settings, null, '\t'));
		console.error(`Файл «${relativePath}» не найден — создан шаблон для заполнения.`);
		finishProcess();
	} else {
		settings = JSON.parse(readProjectFileContent(projectObject, false));
	}

	const reports = [];
	let problem;
	let objectName;
	const serverPortDesignation = 'Порт сервера';
	const accessPasswordDesignation = 'Пароль доступа к ресурсам';

	objectName = 'Структура настроек веб-сервера';
	problem = isNotStructure(settings.webServer, objectName);
	if (problem) {
		reports.push(problem);
	} else {
		const errors = [];
		problem = isNotServerPort(settings.webServer.port, serverPortDesignation);
		if (problem) {
			errors.push(problem);
		}
		problem = isNotNotEmptyString(settings.webServer.password, accessPasswordDesignation);
		if (problem) {
			errors.push(problem);
		}
		if (errors.length !== 0) {
			reports.push(`Проверка не пройдена для «${objectName}» → ${errors.join(' ')}`);
		}
	}

	objectName = 'Структура параметров обращения к API';
	problem = isNotStructure(settings.usedApi, objectName);
	if (problem) {
		reports.push(problem);
	} else {
		const errors = [];
		problem = isNotNotEmptyString(settings.usedApi.name, 'Наименование сервиса');
		if (problem) {
			errors.push(problem);
		} else if (!['Google AI Studio', 'OpenRouter'].includes(settings.usedApi.name)) {
			errors.push('Недопустимое наименование сервиса.');
		}
		problem = isNotNotEmptyString(settings.usedApi.model, 'Идентификатор языковой модели');
		if (problem) {
			errors.push(problem);
		}
		problem = isNotNaturalNumber(settings.usedApi.tokensLimit, 'Предельное число токенов контекста');
		if (problem) {
			errors.push(problem);
		}
		problem = isNotBoolean(settings.usedApi.provideMetadata, 'Потребность предоставлять метаданные');
		if (problem) {
			errors.push(problem);
		}
		if (errors.length !== 0) {
			reports.push(`Проверка не пройдена для «${objectName}» → ${errors.join(' ')}`);
		}
	}

	objectName = 'Структура с опциями обращения к серверу MySQL';
	problem = isNotStructure(settings.mysqlServer, objectName);
	if (problem) {
		reports.push(problem);
	} else {
		const errors = [];
		problem = isNotNotEmptyString(settings.mysqlServer.host, 'Адрес подключения');
		if (problem) {
			errors.push(problem);
		}
		problem = isNotServerPort(settings.mysqlServer.port, serverPortDesignation);
		if (problem) {
			errors.push(problem);
		}
		problem = isNotNotEmptyString(settings.mysqlServer.user, 'Имя пользователя');
		if (problem) {
			errors.push(problem);
		}
		problem = isNotNotEmptyString(settings.mysqlServer.password, accessPasswordDesignation);
		if (problem) {
			errors.push(problem);
		}
		if (errors.length !== 0) {
			reports.push(`Проверка не пройдена для «${objectName}» → ${errors.join(' ')}`);
		}
	}

	if (reports.length === 1) {
		console.error(`В файле «${relativePath}» обнаружена ошибка → ${reports[0]}`);
		finishProcess();
	} else if (reports.length > 1) {
		console.error(`Файл «${relativePath}» не прошёл валидацию:\n${reports.join('\n')}`);
		finishProcess();
	}
}

function checkApiKeysAndGetArray() {
	const projectObject = projectPaths.apiKeys.list;
	const relativePath = path.relative(__dirname, projectObject);
	let list = readArrayFromProjectFile(projectObject);

	if (list.length === 0) {
		console.error('Ни один API-ключ не указан.');
		finishProcess();
	}
	const problems = [];
	for (let index = 0; index < list.length; index++) {
		if (isNotNotEmptyString(list[index], 'API-ключ')) {
			problems.push(index + 1);
		}
	}
	if (problems.length === 1) {
		console.error(`Элемент массива файла «${relativePath}» под номером «${problems[0]}» не является непустой строкой.`);
		finishProcess();
	} else if (problems.length > 1) {
		console.error(`Следующие номера элементов массива файла «${relativePath}» не является непустой строкой: ${problems.join(', ')}.`);
		finishProcess();
	}

	const withoutRepeating = Array.from(new Set(list));
	if (list.length !== withoutRepeating.length) {
		list = withoutRepeating;
		writeIntoFile(projectObject, JSON.stringify(list, null, '\t'));
		console.log(`Из массива файла «${relativePath}» исключены повторяющиеся значения.`);
	}
	return list;
}

function getShortApiKey() {
	const lengthLimit = 25;
	return `${apiKey.substring(0, lengthLimit)}${apiKey.length > lengthLimit ? '…' : ''}`;
}

function highlightApiKeyValue() {
	return `Значение «${getShortApiKey()}» взято в качестве API-ключа.`;
}

function changeApiKey() {
	const list = checkApiKeysAndGetArray();
	let feedback;
	if (list.length > 1) {
		const currentIndex = list.indexOf(apiKey);
		if (currentIndex === -1 || currentIndex === list.length - 1) {
			apiKey = list[0];
			feedback = 'Выбран первый элемент из списка.';
		} else {
			const nextIndex = currentIndex + 1;
			apiKey = list[nextIndex];
			if (nextIndex === list.length - 1) {
				feedback = 'Выбран последний элемент из списка.';
			} else {
				feedback = `Выбран элемент из списка под номером «${nextIndex + 1}».`;
			}
		}
		writeIntoFile(projectPaths.apiKeys.selected, apiKey);
	} else {
		apiKey = list[0];
		feedback = 'Выбран элемент, который является единственным в списке.';
	}
	return `${feedback} ${highlightApiKeyValue()}`;
}

function selectApiKey() {
	if (!apiKey) {
		apiKey = readProjectFileContent(projectPaths.apiKeys.selected, true);
		if (apiKey === '') {
			console.log(changeApiKey());
		} else {
			console.log(highlightApiKeyValue());
		}
	}
}



// ===== Валидация, контроль и подготовка истории =====

const messageStructureDesignation = 'Структура сообщения чата';
const textContentDesignation = 'Текстовое содержимое';

function validateHistoryAndGetArray() {
	const projectObject = projectPaths.history;
	const relativePath = path.relative(__dirname, projectObject);
	const collection = readArrayFromProjectFile(projectObject);
	const reports = [];

	for (let index = 0; index < collection.length; index++) {
		const structure = collection[index];
		const errors = [];
		let problem;

		problem = isNotStructure(structure, messageStructureDesignation);
		if (problem) {
			errors.push(problem);
		} else {
			problem = isNotNotEmptyString(structure.role, 'Роль отправителя');
			if (problem) {
				errors.push(problem);
			} else if (!['assistant', 'system', 'user'].includes(structure.role)) {
				errors.push('Недопустимое значение для роли отправителя.');
			}
			problem = isNotNotEmptyString(structure.content, textContentDesignation);
			if (problem) {
				errors.push(problem);
			}
			problem = isNotInteger(structure.timestamp, 'Метка времени создания');
			if (problem) {
				errors.push(problem);
			}
			problem = isNotNaturalNumber(structure.identifier, 'Идентификатор структуры');
			if (problem) {
				errors.push(problem);
			}
		}

		if (errors.length !== 0) {
			reports.push(`${index + 1} → ${errors.join(' ')}`);
		}
	}

	if (reports.length === 1) {
		console.error(`Обнаружена ошибка в элементе массива файла «${relativePath}» под номером «${reports[0]}».`);
		finishProcess();
	} else if (reports.length > 1) {
		console.error(`Следующие номера элементов массива файла «${relativePath}» не прошли проверку:\n${reports.join('\n')}.`);
		finishProcess();
	}
	return collection;
}

function getHexHash(stringValue) {
	const hash = crypto.createHash('sha256');
	hash.update(stringValue, 'utf8');
	return hash.digest('hex');
}

function buildChatHistory(collection, remainingTokensQuantity) {
	chatMessages = [];
	let complete = false;
	for (let elementIndex = collection.length - 1; elementIndex > -1 && !complete; elementIndex--) {
		const structure = collection[elementIndex];
		const requiredAmount = tokenizer.encode(JSON.stringify(structure, null, '\t')).length;
		if (requiredAmount <= remainingTokensQuantity) {
			chatMessages.unshift(structure);
			remainingTokensQuantity -= requiredAmount;
		} else {
			complete = true;
		}
	}
	serverChatHash = getHexHash(JSON.stringify(chatMessages, null, '\t'));
}

function generateStructureIdentifier(collection) {
	const existingValues = [];
	for (let structure of collection) {
		existingValues.push(structure.identifier);
	}
	let maximumValue = 0;
	for (let currentValue of existingValues) {
		if (currentValue > maximumValue) {
			maximumValue = currentValue;
		}
	}
	return maximumValue + 1;
}

const metadataOriginPrefix = '(Системные метаданные)';

function pushIntoHistory(role, content) {
	if (settings.usedApi.provideMetadata === true) {
		const insertionIndex = content.indexOf(metadataOriginPrefix);
		if (insertionIndex !== -1) {
			content = content.substring(0, insertionIndex);
		}
	}
	content = content.trim();
	if (content === '') {
		return { successValue: false, feedbackValue: 'Текстовое содержимое стало пустым после обработки.' };
	}
	const collection = validateHistoryAndGetArray();
	const identifier = generateStructureIdentifier(collection);
	collection.push({ role: role, content: content.trim(), timestamp: Date.now(), identifier: identifier });
	writeIntoFile(projectPaths.history, JSON.stringify(collection, null, '\t'));
	return { successValue: true, feedbackValue: `Сообщение внесено в историю чата под идентификатором «${identifier}».` };
}

function deleteFromHistory(identifier) {
	const initial = validateHistoryAndGetArray();
	const updated = initial.filter(structure => structure.identifier !== identifier);
	const resultPrefix = `Сообщение с идентификатором «${identifier}» →`;
	if (updated.length < initial.length) {
		writeIntoFile(projectPaths.history, JSON.stringify(updated, null, '\t'));
		return { successValue: true, feedbackValue: `${resultPrefix} Удалено из чата.` };
	} else {
		return { successValue: false, feedbackValue: `${resultPrefix} Не найдено в чате.` };
	}
}



// ===== Сбор системных инструкций для языковой модели и подготовка перед обращением к API =====

function visualizeTimestampsDifference(previousValue, nextValue) {
	const errors = [];
	let problem;

	problem = isNotInteger(previousValue, 'Предыдущая метка времени');
	if (problem) {
		errors.push(problem);
	}
	problem = isNotInteger(nextValue, 'Последующей метка времени');
	if (problem) {
		errors.push(problem);
	}
	if (errors.length === 0 && previousValue > nextValue) {
		errors.push('Значение предыдущей метки времени больше последующей.');
	}
	if (errors.length !== 0) {
		console.error(`Не удалось визуализировать разницу между двумя метками времени → ${errors.join(' ')}`);
		finishProcess();
	}

	let remains = nextValue - previousValue;
	const inSecond = 1000;
	const inMinute = 60 * inSecond;
	const inHour = 60 * inMinute;
	const inDay = 24 * inHour;
	const parts = [];
	const days = Math.floor(remains / inDay);
	if (days > 0) {
		parts.push(`${days} ${matchWord(days, 'д', 'ней', 'ень', 'ня')}`);
	}
	remains %= inDay;
	const hours = Math.floor(remains / inHour);
	if (hours > 0) {
		parts.push(`${hours} ${matchWord(hours, 'час', 'ов', '', 'а')}`);
	}
	remains %= inHour;
	const minutes = Math.floor(remains / inMinute);
	if (minutes > 0) {
		parts.push(`${minutes} ${matchWord(minutes, 'минут', '', 'а', 'ы')}`);
	}
	remains %= inMinute;
	const seconds = Math.floor(remains / inSecond);
	if (seconds > 0) {
		parts.push(`${seconds} ${matchWord(seconds, 'секунд', '', 'а', 'ы')}`);
	}
	if (parts.length === 0) {
		return 'Существенного отличия нет';
	}
	return `[${parts.join(', ')}]`;
}

function formExtraDetails(collection) {
	let information = settings.usedApi.provideMetadata === true ? `Текущая метка времени → ${getTimestamp()}.` : 'Дополнительная информация:';
	const hintFraming = '[ПОДСКАЗКА]';
	if (collection.length !== 0) {
		let demand = '[ТРЕБОВАНИЕ] Ты **НЕ МОЖЕШЬ** отвечать от лица пользователя. Ты отвечаешь **ТОЛЬКО ЗА СЕБЯ**, со стороны языковой модели.';
		if (settings.usedApi.provideMetadata === true) {
			demand += ' Приписывать метаданные, такие как идентификатор сообщения и время создания, **НЕ НУЖНО** — за это ответственна система.';
		}
		const lastStructure = collection[collection.length - 1];
		if (lastStructure.role === 'assistant') {
			information += `\n${demand}\n${hintFraming} Сейчас сложилась такая ситуация, что ты самоинициативно обращаешься к пользователю.`;
		} else if (lastStructure.role === 'system') {
			information += `\n${demand}\n${hintFraming} Последнее сообщение в чате является результатом предшествующего использования функционала инструментов.`;
		}
		if (settings.usedApi.provideMetadata === true) {
			let timePassedInformation = '\nРазница между текущим временем и тем, когда в последний раз было отправлено сообщение в чат:';
			const lastAssistantStructure = collection.findLast(structure => structure.role === 'assistant');
			if (lastAssistantStructure) {
				timePassedInformation += `\nОт тебя → ${visualizeTimestampsDifference(lastAssistantStructure.timestamp, Date.now())}.`;
			}
			const lastUserStructure = collection.findLast(structure => structure.role === 'user');
			if (lastUserStructure) {
				timePassedInformation += `\nСо стороны пользователя → ${visualizeTimestampsDifference(lastUserStructure.timestamp, Date.now())}.`;
			}
			if (lastAssistantStructure || lastUserStructure) {
				information += timePassedInformation;
			}
		}
	} else {
		information += `\n${hintFraming} История чата пуста, поскольку первый ход пользователя пропущен. Тебе следует лишь поприветствоваться.`;
	}
	return information;
}

function highlightInvalidApiKey(problemPrefix, errors) {
	const stringValue = `${problemPrefix} Недействительный ключ «${getShortApiKey()}».`;
	errors.push(stringValue);
	console.error(stringValue);
}

function highlightProhibitedContent(problemPrefix, errors) {
	const stringValue = `${problemPrefix} Запрос был заблокирован из-за нарушения политики допустимого использования.`;
	errors.push(stringValue);
	console.error(stringValue);
}

function highlightDataReceived(problemPrefix, feedbacks) {
	const stringValue = 'Операция получения данных завершена.';
	feedbacks.push(stringValue);
	console.log(stringValue);
}

function extractMetadata(structure) {
	return `${metadataOriginPrefix} Идентификатор сообщения: «${structure.identifier}». Время создания: ${getTimestamp(structure.timestamp)}.`;
}

function prepareAllSendData() {
	if (settings.usedApi.name === 'Google AI Studio') {
		prepareAllSendDataForGoogleAiStudio();
	} else {
		prepareAllSendDataForOpenRouter();
	}
}

const instructionsDesignation = 'Инструкции для языковой модели';
const safeMultiplier = 0.9;

// Реализация для Google AI Studio.

const notFromUserStatement = 'Это сообщение было сгенерировано системой, поэтому оно никак не связано с пользователем.';

function createSystemMessageForGoogleAiStudio(content) {
	return {
		role: 'user',
		parts: [
			{ text: content },
			{ text: notFromUserStatement }
		]
	};
}

function buildSystemContentForGoogleAiStudio() {
	let data;
	const collection = validateHistoryAndGetArray();
	data = formExtraDetails(collection);
	instructionsForModel = { parts: [{ text: data }] };
	data = readProjectFileContent(projectPaths.instructions, false);
	if (!isNotNotEmptyString(data, instructionsDesignation)) {
		instructionsForModel.parts.unshift({ text: data });
	}

	const remainingTokensQuantity = Math.floor(settings.usedApi.tokensLimit * safeMultiplier) - tokenizer.encode(JSON.stringify(instructionsForModel, null, '\t')).length;
	if (remainingTokensQuantity < 0) {
		console.error('Недостаточно токенов для формирования системных инструкций.');
		finishProcess();
	}
	return { collection, remainingTokensQuantity };
}

function prepareAllSendDataForGoogleAiStudio() {
	const { collection, remainingTokensQuantity } = buildSystemContentForGoogleAiStudio();
	buildChatHistory(collection, remainingTokensQuantity);
	messagesForApi = [];
	for (let structure of chatMessages) {
		const message = { parts: [{ text: structure.content }] };
		if (settings.usedApi.provideMetadata === true) {
			message.parts.push({ text: extractMetadata(structure) });
		}
		if (structure.role === 'assistant') {
			message.role = 'model';
		} else if (structure.role === 'system') {
			message.role = 'user';
			message.parts.push({ text: notFromUserStatement });
		} else {
			message.role = 'user';
		}
		messagesForApi.push(message);
	}
	if (messagesForApi.length !== 0 && messagesForApi[0].role !== 'user') {
		messagesForApi.unshift(createSystemMessageForGoogleAiStudio('Фактически, первый ход пользователя пропущен.'));
	}
}

async function askGoogleAiStudio(feedbacks, errors) {
	let messageContent;
	let stringValue;
	const problemPrefix = 'Проблема использования Google AI Studio API →';

	try {
		const genAI = new GoogleGenerativeAI(apiKey);
		const model = genAI.getGenerativeModel({
			model: settings.usedApi.model,
			systemInstruction: instructionsForModel
		});
		const chat = model.startChat({ history: messagesForApi });
		const result = await chat.sendMessage('');
		const response = await result.response;
		messageContent = response.text();
		highlightDataReceived(problemPrefix, feedbacks);

	} catch (error) {
		if (error.message.includes('User location is not supported')) {
			stringValue = `${problemPrefix} Локация IP-адреса не поддерживается.`;
			errors.push(stringValue);
			console.error(stringValue);
		} else if (error.message.includes('PROHIBITED_CONTENT')) {
			highlightProhibitedContent(problemPrefix, errors);
		} else if (error.message.includes('API key not valid')) {
			highlightInvalidApiKey(problemPrefix, errors);
		} else if (error.message.includes('You exceeded your current quota')) {
			stringValue = `${problemPrefix} Достигнут лимит по запросам для ключа «${getShortApiKey()}».`;
			errors.push(stringValue);
			console.error(stringValue);
		} else {
			stringValue = `{problemPrefix} ${formatErrorMessage(error)}`;
			errors.push(stringValue);
			console.error(stringValue);
		}
	}

	return messageContent;
}



// Реализация для OpenRouter.

function createSystemMessageForOpenRouter(content) {
	return { role: 'system', content: content };
}

function buildSystemContentForOpenRouter() {
	const systemMessages = [];
	let data;
	data = readProjectFileContent(projectPaths.instructions, false);
	if (!isNotNotEmptyString(data, instructionsDesignation)) {
		systemMessages.push(createSystemMessageForOpenRouter(data));
	}
	const collection = validateHistoryAndGetArray();
	data = formExtraDetails(collection);
	systemMessages.push(createSystemMessageForOpenRouter(data));

	const remainingTokensQuantity = Math.floor(settings.usedApi.tokensLimit * safeMultiplier) - tokenizer.encode(JSON.stringify(systemMessages, null, '\t')).length;
	if (remainingTokensQuantity < 0) {
		console.error('Недостаточно токенов для формирования системных сообщений.');
		finishProcess();
	}
	return { systemMessages, collection, remainingTokensQuantity };
}

function prepareAllSendDataForOpenRouter() {
	const { systemMessages, collection, remainingTokensQuantity } = buildSystemContentForOpenRouter();
	buildChatHistory(collection, remainingTokensQuantity);
	messagesForApi = [];
	for (let structure of chatMessages) {
		const message = { role: structure.role, content: structure.content };
		if (settings.usedApi.provideMetadata === true) {
			message.content += `\n\n${extractMetadata(structure)}`;
		}
		messagesForApi.push(message);
	}
	messagesForApi = messagesForApi.concat(systemMessages);
}

async function askOpenRouter(feedbacks, errors) {
	let stringValue;
	const problemPrefix = 'Проблема использования OpenRouter API →';
	let request;
	let response;

	try {
		const controller = new AbortController();
		const timeoutObject = setTimeout(() => controller.abort(), 5 * 60 * 1000);
		request = await fetch('https://openrouter.ai/api/v1/chat/completions', {
			signal: controller.signal,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`
			},
			body: JSON.stringify({
				model: settings.usedApi.model,
				messages: messagesForApi
			}),
		});
		response = await request.json();
		clearTimeout(timeoutObject);
		highlightDataReceived(problemPrefix, feedbacks);

	} catch (error) {
		if (error.name === 'AbortError') {
			stringValue = `${problemPrefix} Превышено время ожидания запроса.`;
			errors.push(stringValue);
			console.error(stringValue);
		} else if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
			stringValue = `${problemPrefix} Не удалось подключиться к серверу.`;
			errors.push(stringValue);
			console.error(stringValue);
		} else {
			stringValue = `${problemPrefix} ${formatErrorMessage(error)}`;
			errors.push(stringValue);
			console.error(stringValue);
		}
	}

	if (!request || !response) {
		stringValue = 'Не удалось получить ответ на запрос.';
		errors.push(stringValue);
		console.error(stringValue);
	} else if (!request.ok) {
		if (!response.error.code) {
			stringValue = `${problemPrefix} Неизвестный код ошибки.`;
			errors.push(stringValue);
			console.error(stringValue);
		} else {
			if (response.error.code === 400) {
				stringValue = `${problemPrefix} Ошибка запроса: некорректные или отсутствующие параметры.`;
				errors.push(stringValue);
				console.error(stringValue);
			} else if (response.error.code === 401) {
				highlightInvalidApiKey(problemPrefix, errors);
			} else if (response.error.code === 403) {
				highlightProhibitedContent(problemPrefix, errors);
			} else if (response.error.code === 429 || response.error.code === 402) {
				stringValue = `${problemPrefix} Либо сервер в данный момент времени испытывает нагрузку по числу запросов, либо достигнут лимит для ключа «${getShortApiKey()}».`;
				errors.push(stringValue);
				console.error(stringValue);
			} else {
				if (!response.error.message) {
					stringValue = `${problemPrefix} Неизвестное сообщение об ошибке с кодом «${response.error.code}».`;
					errors.push(stringValue);
					console.error(stringValue);
				} else {
					stringValue = `${problemPrefix} ${formatErrorMessage(response.error)}`;
					errors.push(stringValue);
					console.error(stringValue);
				}
			}
		}
	}

	let messageContent;
	if (
		response &&
		!isNotArray(response.choices, 'Массив структур') &&
		!isNotStructure(response.choices[0].message, messageStructureDesignation) &&
		!isNotNotEmptyString(response.choices[0].message.content, textContentDesignation)
	) {
		messageContent = response.choices[0].message.content;
	}
	return messageContent;
}



// ===== Главная функция, глобальные вызовы и веб-сервер для работоспособности онлайн-чата =====

async function processMessage(role, messageContent, feedbacks, errors) {
	let { successValue, feedbackValue } = pushIntoHistory(role, messageContent);
	if (successValue) {
		feedbacks.push(feedbackValue);
		console.log(feedbackValue);
		let programParsing;
		try {
			programParsing = await executeCommands(messageContent);
		} catch (error) {
			let stringValue = `Произошла ошибка во время парсинга команд → ${formatErrorMessage(error)}`;
			errors.push(stringValue);
			console.error(stringValue);
		}
		if (!isNotNotEmptyString(programParsing)) {
			console.log(`Парсинг программой → {\n${programParsing}\n}`);
			({ successValue, feedbackValue } = pushIntoHistory('system', programParsing));
			if (successValue) {
				feedbacks.push(feedbackValue);
				console.log(feedbackValue);
			} else {
				errors.push(feedbackValue);
				console.error(feedbackValue);
			}
		}
		prepareAllSendData();
	} else {
		errors.push(feedbackValue);
		console.error(feedbackValue);
	}
}

async function main() {
	let stringValue;
	const feedbacks = [];
	const errors = [];

	try {
		selectApiKey();
		prepareAllSendData();
		let numberOfTokens = tokenizer.encode(JSON.stringify(messagesForApi, null, '\t')).length;
		if (settings.usedApi.name === 'Google AI Studio') {
			numberOfTokens += tokenizer.encode(JSON.stringify(instructionsForModel, null, '\t')).length;
		}
		stringValue = `Приближённое число потраченных токенов на запрос → ${numberOfTokens}.`;
		feedbacks.push(stringValue);
		console.log(stringValue);
	} catch (error) {
		console.error(`Перед генерацией ответа произошла ошибка → ${formatErrorMessage(error)}`);
		finishProcess();
	}

	let messageContent;
	if (settings.usedApi.name === 'Google AI Studio') {
		messageContent = await askGoogleAiStudio(feedbacks, errors);
	} else {
		messageContent = await askOpenRouter(feedbacks, errors);
	}
	waitingForResponse = false;

	if (!isNotNotEmptyString(messageContent)) {
		stringValue = `Приближённое число полученных токенов → ${tokenizer.encode(messageContent).length}.`;
		feedbacks.push(stringValue);
		console.log(stringValue);
		console.log(`Ответ языковой модели → {\n${messageContent}\n}`);
		await processMessage('assistant', messageContent, feedbacks, errors);
	} else {
		stringValue = 'Не был получен результат генерации языковой модели.';
		errors.push(stringValue);
		console.error(stringValue);
	}

	const conclusion = {};
	conclusion.message = feedbacks.concat(errors).join(' ');
	if (errors.length === 0) {
		conclusion.success = true;
	} else {
		conclusion.success = false;
	}
	return conclusion;
}

try {
	readConfiguration();
	selectApiKey();
	prepareAllSendData();
} catch (error) {
	console.error(`Во время глобальных вызовов произошла ошибка → ${formatErrorMessage(error)}`);
	finishProcess();
}

function validateUserPassword(userPassword, sourceOfSenderPrefix) {
	let errorStructure;
	const problem = isNotNotEmptyString(userPassword, 'Предоставленный пароль');
	if (problem) {
		errorStructure = { status: 400, messageForClient: problem, messageForServer: `${sourceOfSenderPrefix} Доступ отказан → ${problem}` };
	} else if (userPassword.trim() !== settings.webServer.password.trim()) {
		errorStructure = { status: 401, messageForClient: 'Предоставленный пароль не совпадает с тем, который стоит на сервере.', messageForServer: `${sourceOfSenderPrefix} Совершена неудачная попытка запроса ресурсов сервера.` };
	}
	return errorStructure;
}

process.stdout.write(`\x1b]0;${path.basename(__dirname)}\x07`);
const serverErrorMessage = 'Произошла внутренняя ошибка сервера.';
const serverErrorPrefix = 'Не удалось обработать запрос пользователя →';
const application = express();
application.use(express.json());
application.use(express.static(projectPaths.website));

application.post('/history', async (request, response) => {
	try {
		const { userPassword, userChatHash } = request.body;
		const sourceOfSenderPrefix = `Пользователь с IP-адреса «${request.ip}» →`;

		const errorStructure = validateUserPassword(userPassword, sourceOfSenderPrefix);
		if (errorStructure) {
			response.status(errorStructure.status).json({ success: false, message: errorStructure.messageForClient });
			console.log(errorStructure.messageForServer);
			return;
		}

		prepareAllSendData();
		const chatContentPrefix = 'Содержимое истории чата →';
		if (userChatHash !== serverChatHash) {
			response.json({ success: true, history: chatMessages, hashcode: serverChatHash, message: `${chatContentPrefix} Получено новое.` });
			console.log(`${sourceOfSenderPrefix} Клиент обновил свои данные после запроса ресурсов сервера.`);
		} else {
			response.json({ success: true, message: `${chatContentPrefix} На данный момент совпадает с полученым ранее.` });
			console.log(`${sourceOfSenderPrefix} Не были отправлены ресурсы сервера, поскольку они совпадают с уже имеющимися у клиента данными.`);
		}

	} catch (error) {
		response.status(500).json({ success: false, message: serverErrorMessage });
		console.error(`${serverErrorPrefix} Получение истории чата → ${formatErrorMessage(error)}`);
	}
});

application.post('/message', async (request, response) => {
	const sendMessagePrefix = 'Отправка нового сообщения в чат →';
	try {
		const { userPassword, messageContent } = request.body;
		const sourceOfSenderPrefix = `Пользователь с IP-адреса «${request.ip}» →`;

		const errorStructure = validateUserPassword(userPassword, sourceOfSenderPrefix);
		if (errorStructure) {
			response.status(errorStructure.status).json({ success: false, message: errorStructure.messageForClient });
			console.log(errorStructure.messageForServer);
			return;
		}

		if (waitingForResponse) {
			response.status(429).json({ success: false, message: `${sendMessagePrefix} Следует дождаться окончания генерации ответа языковой модели.` });
			console.log(`${sourceOfSenderPrefix} ${sendMessagePrefix} Операция прервана во время генерации ответа языковой модели.`);
			return;
		}

		let problem = isNotNotEmptyString(messageContent, 'Содержимое текстового контента');
		const limitMessageLength = 4096;
		if (!problem) {
			if (messageContent.length > limitMessageLength) {
				problem = `Сообщение не должно превышать ${limitMessageLength} ${matchWord(limitMessageLength, 'символ', 'ов', '', 'а')}.`;
			} else {
				console.log(`${sourceOfSenderPrefix} Клиент отправил новое сообщение → {\n${messageContent}\n}`);
				const feedbacks = [];
				const errors = [];
				await processMessage('user', messageContent, feedbacks, errors);
				const conclusion = {};
				conclusion.message = feedbacks.concat(errors).join(' ');
				if (errors.length === 0) {
					conclusion.success = true;
				} else {
					conclusion.success = false;
				}
				response.json(conclusion);
				return;
			}
		}
		response.status(400).json({ success: false, message: problem });
		console.log(`${sourceOfSenderPrefix} Входящее сообщение отказано → ${problem}`);

	} catch (error) {
		response.status(500).json({ success: false, message: serverErrorMessage });
		console.error(`${serverErrorPrefix} ${sendMessagePrefix} → ${formatErrorMessage(error)}`);
	}
});

application.post('/delete', async (request, response) => {
	try {
		const { userPassword, messageIdentifier } = request.body;
		const sourceOfSenderPrefix = `Пользователь с IP-адреса «${request.ip}» →`;

		const errorStructure = validateUserPassword(userPassword, sourceOfSenderPrefix);
		if (errorStructure) {
			response.status(errorStructure.status).json({ success: false, message: errorStructure.messageForClient });
			console.log(errorStructure.messageForServer);
			return;
		}

		let problem = isNotNaturalNumber(messageIdentifier, 'Идентификатор сообщения');
		if (!problem) {
			const { successValue, feedbackValue } = deleteFromHistory(messageIdentifier);
			if (successValue === true) {
				response.json({ success: true, message: feedbackValue });
				prepareAllSendData();
				console.log(`${sourceOfSenderPrefix} Клиент изменил историю → ${feedbackValue}`);
				return;
			} else {
				problem = feedbackValue;
			}
		}
		response.status(400).json({ success: false, message: problem });
		console.log(`${sourceOfSenderPrefix} Клиент не смог изменить историю → ${problem}`);

	} catch (error) {
		response.status(500).json({ success: false, message: serverErrorMessage });
		console.error(`${serverErrorPrefix} Удаление сообщения из истории чата → ${formatErrorMessage(error)}`);
	}
});

application.post('/change', async (request, response) => {
	try {
		const { userPassword } = request.body;
		const sourceOfSenderPrefix = `Пользователь с IP-адреса «${request.ip}» →`;

		const errorStructure = validateUserPassword(userPassword, sourceOfSenderPrefix);
		if (errorStructure) {
			response.status(errorStructure.status).json({ success: false, message: errorStructure.messageForClient });
			console.log(errorStructure.messageForServer);
			return;
		}

		const feedback = changeApiKey();
		response.json({ success: true, message: feedback });
		console.log(`${sourceOfSenderPrefix} Клиент запросил смену API-ключа → ${feedback}`);

	} catch (error) {
		response.status(500).json({ success: false, message: serverErrorMessage });
		console.error(`${serverErrorPrefix} Смена действующего API-ключа ${formatErrorMessage(error)}`);
	}
});

application.post('/generate', async (request, response) => {
	const responseModelPrefix = 'Генерация ответа языковой модели →';
	try {
		const { userPassword } = request.body;
		const sourceOfSenderPrefix = `Пользователь с IP-адреса «${request.ip}» →`;

		const errorStructure = validateUserPassword(userPassword, sourceOfSenderPrefix);
		if (errorStructure) {
			response.status(errorStructure.status).json({ success: false, message: errorStructure.messageForClient });
			console.log(errorStructure.messageForServer);
			return;
		}

		if (waitingForResponse) {
			response.status(429).json({ success: false, message: `${responseModelPrefix} Происходит в данный момент времени.` });
			console.log(`${sourceOfSenderPrefix} ${responseModelPrefix} Отказано при попытке начать параллельный процесс.`);
			return;
		}
		waitingForResponse = true;
		response.json(await main());

	} catch (error) {
		response.status(500).json({ success: false, message: serverErrorMessage });
		console.error(`${serverErrorPrefix} ${responseModelPrefix} ${formatErrorMessage(error)}`);
		waitingForResponse = false;
	}
});

let serverInstance;

function expressListen() {
	rememberedWebServerPort = settings.webServer.port;
	if (serverInstance) {
		serverInstance.close(() => {
			console.log('Существующий веб-сервер закрыт.');
		});
	}
	openWebServer();
}

function openWebServer() {
	serverInstance = application.listen(settings.webServer.port, () => {
		console.log(`Веб-сервер доступен через [http://localhost:${settings.webServer.port}].`);
	});
	const serverProblemPrefix = 'Не удалось открыть сервер →';
	serverInstance.on('error', (error) => {
		if (error.code === 'EADDRINUSE') {
			console.error(`${serverProblemPrefix} Указанный порт занят другим процессом.`);
			finishProcess();
		} else if (error.code === 'EACCES') {
			console.error(`${serverProblemPrefix} Нет прав для запуска с этим портом.`);
			finishProcess();
		}
	});
}

expressListen();

fs.watchFile(projectPaths.configuration, { interval: 1000 }, (currentState, previousState) => {
	if (currentState.mtime.getTime() !== previousState.mtime.getTime()) {
		console.log('Выполняется повторная загрузка настроек, поскольку была обнаружена модификация файла конфигурации.');
		readConfiguration();
		if (rememberedWebServerPort !== settings.webServer.port) {
			console.log('Будет произведён перезапуск веб-сервера, поскольку значение порта было перезаписано.');
			expressListen();
		}
	}
});



// ===== Алгоритмы обработки текста для вызовов команд по их синтаксису =====

const firstDelimiter = '($$$$$';
const intermediateDelimiter = '$$$$$, $$$$$';
const lastDelimiter = '$$$$$)';

function pullArguments(baseString, syntaxBeginIndex, commandName, argumentsQuantity) {
	const problem = isNotNaturalNumber(argumentsQuantity);
	if (problem) {
		throw new Error('Для команды, требующей аргументы, их количество должно быть указано натуральным числом.');
	}

	// Команда, которая должна иметь аргументы, может быть упомянута без них, и тогда следует сразу же её пропустить.
	if (baseString.indexOf(firstDelimiter, syntaxBeginIndex + commandName.length) !== syntaxBeginIndex + commandName.length) {
		return undefined;
	}

	const result = []; // Массив, формирующийся по принципу: впереди идут строковые значения, а конец всегда является числом.
	const commandStart = commandName + firstDelimiter;
	let currentIndex = syntaxBeginIndex + commandStart.length; // Перемещение на позицию, начиная с которой, должна идти подстрока, содержащая аргумент.

	for (let order = 1; order <= argumentsQuantity; order++) {
		// Проверка на существование ограничителя, предполагаемого на основе оставшегося числа аргументов.
		const isLast = order === argumentsQuantity;
		const nextDelimiter = isLast ? lastDelimiter : intermediateDelimiter;
		const delimiterIndex = baseString.indexOf(nextDelimiter, currentIndex);
		if (delimiterIndex === -1) {
			return undefined;
		}

		const argumentBeginningIndex = currentIndex;
		const argumentEndingIndex = delimiterIndex - 1;
		let argument;

		// Предусмотрение случая, когда между начальным и конечным ограничителями аргумента пустая строка.
		if (argumentBeginningIndex > argumentEndingIndex) {
			argument = '';
		} else {
			// Метод substring возвращает подстроку, содержащую символы, начиная с указанного индекса и до, НО НЕ ВКЛЮЧАЯ, другой индекс.
			argument = baseString.substring(argumentBeginningIndex, argumentEndingIndex + 1);
		}

		// Дополнительная проверка отобранного содержимого, исключающая наличие служебных выражений.
		if (argument.includes(firstDelimiter) || argument.includes(intermediateDelimiter) || argument.includes(lastDelimiter)) {
			return undefined;
		}

		result.push(argument); // Строковое значение.
		currentIndex = delimiterIndex + nextDelimiter.length; // Перемещение на позицию, начиная с которой, должна идти подстрока, содержащая аргумент.
	}

	const syntaxEndIndex = currentIndex - 1; // Индекс символа в основной строке, который является концом синтаксиса обработанной команды.
	result.push(syntaxEndIndex); // Числовое значение.
	return result;
}

function selectCommandSyntaxes(baseString) {
	let positionIndex = 0; // Индекс начала поиска команд.
	let complete = false; // Флаг окончания обработки текста.
	const collection = []; // Накопление объектов из синтаксисов команд, которые прошли валидацию.
	do {
		if (positionIndex >= baseString.length) {
			complete = true;
		} else {
			// Определение позиции вхождения каждой подстроки из списка команд.
			const nearestIndexes = [];
			for (let commandName of listOfCommands) {
				// Поиск вызова команды в строке при учёте хотя бы одного параметра.
				let startIndex = baseString.indexOf(commandName + firstDelimiter, positionIndex);
				// Если ранее найти не удалось, проверяется синтаксис команды без аргументов.
				if (startIndex === -1) {
					startIndex = baseString.indexOf(commandName + '()', positionIndex);
				}
				nearestIndexes.push(startIndex);
			}

			// Поиск ближайшего вхождения подстроки с командой при учёте фильтрации отрицательных результатов.
			let syntaxBeginIndex = Infinity; // Определяет, где должен начинаться синтаксис.
			let commandNameIndex = -1; // Индекс строкового названия из списка идентификаторов команд.
			for (let elementIndex = 0; elementIndex < nearestIndexes.length; elementIndex++) {
				const currentElement = nearestIndexes[elementIndex];
				if (currentElement !== -1 && currentElement < syntaxBeginIndex) {
					syntaxBeginIndex = currentElement;
					commandNameIndex = elementIndex;
				}
			}

			// Если хоть одна команда была определена, следует создать объект из её синтаксиса.
			if (syntaxBeginIndex !== Infinity) {
				const commandName = listOfCommands[commandNameIndex];
				let pullResult;
				let syntaxEndIndex;
				switch (commandName) {
					case 'RequestForMySQL': pullResult = pullArguments(baseString, syntaxBeginIndex, commandName, 2); break;
				}
				if (!isNotArray(pullResult, 'Массив, содержащий в себе хотя бы одно строковое значение и число как последний элемент')) {
					syntaxEndIndex = pullResult.pop(); // Извлечение индекса конца синтаксиса команды.
					const structure = {
						commandName: commandName,
						parameters: pullResult
					};
					collection.push(structure);
					positionIndex = syntaxEndIndex + 1; // Наглядный выход из конца синтаксиса команды.
				} else {
					// Если не удалось вызвать обработчик команды, происходит пропуск, равный длине названия.
					positionIndex = syntaxBeginIndex + commandName.length;
				}
			} else {
				complete = true;
			}
		}
	} while (!complete);
	return collection;
}

async function executeCommands(baseString) {
	const feedbacks = []; // Заполняется строковыми откликами результатов выполнения команд.
	const collection = selectCommandSyntaxes(baseString);
	for (let structure of collection) {
		switch (structure.commandName) {
			case 'RequestForMySQL': feedbacks.push(await handleRequestForMySql(structure.parameters)); break;
		}
	}
	// Если строка не содержит ни одного вызова команды, итоговым результатом является undefined.
	let result;
	if (feedbacks.length !== 0) {
		result = feedbacks.join('\n');
	}
	return result;
}



// ===== Обработчики команд управления системой =====

async function handleRequestForMySql(commandParameters) {
	const [contentOption, sqlQuery] = commandParameters;
	const lengthLimit = 100;
	const displayValue = sqlQuery.replace(/\s+/g, ' ').trim();
	const feedback = `Распознана команда RequestForMySQL с параметрами «${contentOption}» и «${displayValue.substring(0, lengthLimit)}${displayValue.length > lengthLimit ? '…' : ''}» →`;

	let problem;
	problem = isNotNotEmptyString(contentOption, 'Опция отображения результата');
	if (problem) {
		return `${feedback} ${problem}`;
	} else if (!['none', 'rows', 'fields', 'all'].includes(contentOption)) {
		return `${feedback} Недопустимая опция отображения результата.`;
	}
	problem = isNotNotEmptyString(sqlQuery, 'SQL-запрос');
	if (problem) {
		return `${feedback} ${problem}`;
	}

	if (JSON.stringify(mysqlConnectionParameters) !== JSON.stringify(settings.mysqlServer)) {
		// Создание копии объекта со включенной функцией выполнения нескольких SQL-операторов в одном запросе, разделенных точкой с запятой.
		mysqlConnectionParameters = { ...settings.mysqlServer, multipleStatements: true };
		if (mysqlPool) {
			await mysqlPool.end();
		}
		mysqlPool = mysql.createPool(mysqlConnectionParameters).promise();
	}

	let rows;
	let fields;
	try {
		[rows, fields] = await mysqlPool.query(sqlQuery);
	} catch (error) {
		const stringValue = formatErrorMessage(error);
		return `${feedback} Произошла ошибка во время вызова${stringValue.includes('\n') ? ':\n' : ' → '}${stringValue}`;
	}

	const successInsertion = 'Запрос выполнен успешно.';
	if (contentOption === 'none') {
		return `${feedback} ${successInsertion}`;
	}
	const resultInsertion = 'Полученный результат:';
	const stringRows = JSON.stringify(rows, null, '\t');
	if (contentOption === 'rows') {
		return `${feedback} ${successInsertion} ${resultInsertion}\n${stringRows}`;
	}
	const stringFields = JSON.stringify(fields, null, '\t');
	if (contentOption === 'fields') {
		return `${feedback} ${successInsertion} ${resultInsertion}\n${stringFields}`;
	}
	return `${feedback} ${successInsertion}\nОбъект «fields»:\n${stringFields}\nОбъект «rows»:\n${stringRows}`;
}