import React from 'react';
import { View, Text, FlatList, Button, StyleSheet } from 'react-native';
import { useTournament, useTournamentMatches } from '@app/hooks/useTournaments';
import { colors } from '@app/styles/colors';

interface Props {
  tournamentId: string;
}

export const TournamentDetailScreen: React.FC<Props> = ({ tournamentId }) => {
  const tournament = useTournament(tournamentId);
  const matches = useTournamentMatches(tournamentId);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{tournament.data?.name ?? 'Torneo'}</Text>
      <Text style={styles.meta}>Estado: {tournament.data?.status}</Text>
      <FlatList
        data={matches.data ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.name}>
              {item.home_team_id} vs {item.away_team_id}
            </Text>
            <Text style={styles.meta}>{item.status}</Text>
            <Button title="Ver partido" onPress={() => {}} />
          </View>
        )}
        ListEmptyComponent={<Text>Sin partidos aún</Text>}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 8, gap: 4, marginBottom: 12, padding: 12 },
  container: { backgroundColor: colors.background, flex: 1, padding: 16 },
  meta: { color: colors.muted, marginBottom: 12 },
  name: { fontSize: 16, fontWeight: '600' },
  title: { fontSize: 24, fontWeight: '600', marginBottom: 8 },
});

