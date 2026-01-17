const logger = require("../utils/logger");

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Extract context for logging
  const logContext = {
    stack: err.stack,
    userId: req.user?.id || req.user?._id,
    path: req.originalUrl || req.path,
    method: req.method,
    statusCode: error.statusCode || 500
  };

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = { message, statusCode: 404 };
    logger.warn(message, logContext);
  }
  // Mongoose duplicate key
  else if (err.code === 11000) {
    const message = 'Duplicate field value entered';
    error = { message, statusCode: 400 };
    logger.warn(message, logContext);
  }
  // Mongoose validation error
  else if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = { message, statusCode: 400 };
    logger.warn(message, logContext);
  }
  // All other errors
  else {
    logger.error(err.message || 'Server Error', logContext);
  }

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || 'Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

module.exports = { errorHandler };

