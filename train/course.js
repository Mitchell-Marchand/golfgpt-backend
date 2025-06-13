export async function getCourse(mariadbPool) {
    const [course] = await mariadbPool.query("SELECT * FROM Courses ORDER BY RAND() LIMIT 1");
    return course[0];
}