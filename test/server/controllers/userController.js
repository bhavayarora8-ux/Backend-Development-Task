const { getUserModel, getAppointmentModel, getAIAnalysisModel, getReportModel } = require('../utils/modelHelper.js');
const { statsCache } = require('../utils/modelHelper.js');

const getUsers = async (req, res, next) => {
  try {
    const { role, search } = req.query;
    const User = getUserModel();
    let query = {};

    if (role) {
      query.role = role;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    let users = await User.find(query);
    
    // Remove passwords and sort
    users = users.map(u => {
      const { password, ...userWithoutPassword } = u;
      return userWithoutPassword;
    });
    
    users.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    users = users.slice(0, 100);

    res.json({
      success: true,
      count: users.length,
      users
    });
  } catch (error) {
    next(error);
  }
};

const getUserById = async (req, res, next) => {
  try {
    const User = getUserModel();
    let user = await User.findById(req.params.id);
    
    // Remove password
    if (user && user.password) {
      const { password, ...userWithoutPassword } = user;
      user = userWithoutPassword;
    }
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    next(error);
  }
};

const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const allowedUpdates = ['name', 'phone', 'dateOfBirth', 'address', 'specialization', 'licenseNumber', 'bloodGroup', 'emergencyContact', 'isActive', 'role'];
    const updates = Object.keys(req.body);
    const isValidOperation = updates.every(update => allowedUpdates.includes(update));

    if (!isValidOperation) {
      return res.status(400).json({ message: 'Invalid updates' });
    }

    const User = getUserModel();
    let user = await User.findByIdAndUpdate(
      id,
      req.body,
      { new: true, runValidators: true }
    );
    
    // Remove password
    if (user && user.password) {
      const { password, ...userWithoutPassword } = user;
      user = userWithoutPassword;
    }

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Clear cache if role was updated
    if (req.body.role) {
      statsCache.clear();
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    next(error);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Don't allow self-deletion
    if (id === req.user.id) {
      return res.status(400).json({ message: 'Cannot delete your own account' });
    }

    const User = getUserModel();
    const user = await User.findByIdAndDelete(id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    statsCache.clear(); // Clear cache after user deletion

    res.json({
      success: true,
      message: 'User deleted'
    });
  } catch (error) {
    next(error);
  }
};

const getDashboardStats = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;

    let stats = {};

    const User = getUserModel();
    const Appointment = getAppointmentModel();
    const AIAnalysis = getAIAnalysisModel();

    if (role === 'admin') {
      // Check cache first
      const cached = statsCache.get();
      if (cached) {
        return res.json({ success: true, stats: cached, cache: true });
      }

      // MongoDB aggregation for user roles
      if (typeof User.aggregate === 'function') {
        const userCounts = await User.aggregate([
          { $group: { _id: '$role', count: { $sum: 1 } } }
        ]);
        stats.totalUsers = userCounts.reduce((sum, r) => sum + r.count, 0);
        stats.totalPatients = userCounts.find(r => r._id === 'patient')?.count || 0;
        stats.totalDoctors = userCounts.find(r => r._id === 'doctor')?.count || 0;
      } else {
        // In-memory calculation
        const users = User.find ? await User.find({}) : [];
        stats.totalUsers = users.length;
        stats.totalPatients = users.filter(u => u.role === 'patient').length;
        stats.totalDoctors = users.filter(u => u.role === 'doctor').length;
      }

      // The rest can use countDocuments (efficient for both modes)
      const [totalAppointments, totalAnalyses, pendingAppointments] = await Promise.all([
        Appointment.countDocuments(),
        AIAnalysis.countDocuments(),
        Appointment.countDocuments({ status: 'pending' }),
      ]);
      stats.totalAppointments = totalAppointments;
      stats.totalAnalyses = totalAnalyses;
      stats.pendingAppointments = pendingAppointments;

      // Cache for 5 minutes
      statsCache.set(stats, 5 * 60 * 1000);
    } else if (role === 'doctor') {
      // ...existing doctor logic (no cache)...
      const myAppointments = await Appointment.countDocuments({ doctor: userId });
      const pendingAppointments = await Appointment.countDocuments({ doctor: userId, status: 'pending' });
      const completedAppointments = await Appointment.countDocuments({ doctor: userId, status: 'completed' });
      const myAnalyses = await AIAnalysis.countDocuments({ doctor: userId });
      const myPatients = await Appointment.distinct('patient', { doctor: userId });

      stats = {
        myAppointments,
        pendingAppointments,
        completedAppointments,
        myAnalyses,
        totalPatients: myPatients.length
      };
    } else if (role === 'patient') {
      // ...existing patient logic (no cache)...
      const myAppointments = await Appointment.countDocuments({ patient: userId });
      const upcomingAppointments = await Appointment.countDocuments({ 
        patient: userId, 
        status: { $in: ['pending', 'confirmed'] },
        appointmentDate: { $gte: new Date() }
      });
      const Report = getReportModel();
      const myReports = await Report.countDocuments({ patient: userId });
      const myAnalyses = await AIAnalysis.countDocuments({ patient: userId });

      stats = {
        myAppointments,
        upcomingAppointments,
        myReports,
        myAnalyses
      };
    }

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    next(error);
  }
};

const getHealthTrends = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;

    const AIAnalysis = getAIAnalysisModel();
    let analyses = [];

    // For admin, get all analyses; for others, get their own
    if (role === 'admin') {
      analyses = await AIAnalysis.find({});
    } else {
      analyses = await AIAnalysis.find({ patient: userId });
    }
    
    // Sort by creation date
    analyses.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    const trends = analyses.map(analysis => ({
      date: analysis.createdAt,
      severity: analysis.aiResponse?.severity || 'low',
      confidence: analysis.aiResponse?.confidence || 0,
      accuracy: analysis.accuracy || null,
      diagnosisCount: analysis.aiResponse?.possibleDiagnosis?.length || 0
    }));

    res.json({
      success: true,
      trends
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
  getDashboardStats,
  getHealthTrends
};
