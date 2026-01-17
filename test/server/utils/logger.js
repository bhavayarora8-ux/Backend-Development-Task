const isProd = process.env.NODE_ENV === 'production';

//Sensitive fields that should never be logged
const SENSITIVE_FIELDS = ['password', 'token', 'authorization', 'jwt', 'secret', 'apiKey', 'api_key'];

//Helper to sanitize objects and remove sensitive data
const sanitize = (obj) => {
	if (!obj || typeof obj !== 'object') return obj;
	const sanitized = Array.isArray(obj) ? [...obj] : { ...obj };

	for (const key in sanitized) {
		const lowerKey = key.toLowerCase();

		//Remove sensitive fields
		if (SENSITIVE_FIELDS.some(field => lowerKey.includes(field))) {
			sanitized[key] = '[REDACTED]';
		} else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
			//Recursively sanitize nested objects 
      sanitized[key] = sanitize(sanitized[key]);
		}
	}
	return sanitized;
};

//Format log entry
const formatLog = (level, message, context = {}) => {
	const logEntry = {
		timestamp: new Date().toISOString(),
		level: level.toUpperCase(),
		message,
		...sanitize(context)
	};

	return logEntry;
};

//Log function
const log = (level, message, context = {}) => {
	const logEntry = formatLog(level, message, context);

	if (isProd) {
		//JSON format for production (can be parsed by log aggregators) 
    console.log(JSON.stringify(logEntry));
	} else {
		//Pretty print for development 
    console.log(`[${logEntry.level}] ${logEntry.timestamp}`);
		console.log(`Message: ${message}`);

		if (context.stack) {
			console.log(`Stack: ${context.stack}`);
		}
		if (context.userId) {
			console.log(`User ID: ${context.userId}`);
		}
		if (context.path) {
			console.log(`Path: ${context.method || 'GET'} ${context.path}`);
		}
		//Log any additional context
		const additionalContext = {
			...context
		};
		delete additionalContext.stack;
		delete additionalContext.userId;
		delete additionalContext.path;
		delete additionalContext.method;

		if (Object.keys(additionalContext).length > 0) {
			console.log('Additional Context:', additionalContext);
		}
		console.log('---');
	}
};

//Export logger with different levels 
module.exports = {
	error: (message, context = {}) => log('error', message, context),
	warn: (message, context = {}) => log('warn', message, context),
	info: (message, context = {}) => log('info', message, context),
  
	//Export sanitize for testing purposes 
  sanitize
};